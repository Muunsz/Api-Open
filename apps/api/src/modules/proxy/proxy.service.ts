import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  BodyConfig,
  ProxyExecuteRequest,
  ProxyExecuteResponse,
} from '@api-open/shared';
import { validateTargetUrl } from '../../common/ssrf.util';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;

@Injectable()
export class ProxyService {
  async execute(payload: ProxyExecuteRequest): Promise<ProxyExecuteResponse> {
    const parsedUrl = await validateTargetUrl(payload.url);

    if (payload.queryParams) {
      for (const [key, value] of Object.entries(payload.queryParams)) {
        if (key) {
          parsedUrl.searchParams.set(key, value ?? '');
        }
      }
    }

    const headers = new Headers();
    if (payload.headers) {
      for (const [key, value] of Object.entries(payload.headers)) {
        if (key.trim()) {
          headers.set(key, value ?? '');
        }
      }
    }

    const body = this.buildBody(payload.method, payload.body, headers);
    const timeoutMs = Math.min(
      Math.max(payload.timeoutMs ?? DEFAULT_TIMEOUT_MS, 500),
      MAX_TIMEOUT_MS,
    );

    const start = performance.now();
    let response: Response;
    try {
      response = await fetch(parsedUrl.toString(), {
        method: payload.method,
        headers,
        body,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to execute target request';
      throw new BadRequestException(`Upstream request failed: ${message}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const durationMs = Math.round(performance.now() - start);

    if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
      throw new BadRequestException(
        `Response exceeded maximum allowed size of ${MAX_RESPONSE_BYTES / (1024 * 1024)} MB`,
      );
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const contentType = responseHeaders['content-type'] ?? '';
    const isBinary = this.isBinaryContentType(contentType);
    const buffer = Buffer.from(arrayBuffer);

    return {
      statusCode: response.status,
      statusText: response.statusText,
      durationMs,
      sizeBytes: buffer.byteLength,
      headers: responseHeaders,
      body: isBinary ? buffer.toString('base64') : buffer.toString('utf8'),
      isBase64: isBinary,
    };
  }

  private buildBody(
    method: string,
    bodyConfig: BodyConfig | undefined,
    headers: Headers,
  ): string | undefined {
    if (!bodyConfig || bodyConfig.mode === 'none') return undefined;
    if (method === 'GET' || method === 'HEAD') return undefined;

    switch (bodyConfig.mode) {
      case 'raw': {
        if (!headers.has('content-type')) {
          const mimeMap: Record<string, string> = {
            json: 'application/json',
            xml: 'application/xml',
            html: 'text/html',
            text: 'text/plain',
          };
          headers.set(
            'content-type',
            mimeMap[bodyConfig.rawType ?? 'text'] ?? 'text/plain',
          );
        }
        return bodyConfig.raw ?? '';
      }
      case 'urlencoded': {
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/x-www-form-urlencoded');
        }
        const params = new URLSearchParams();
        for (const item of bodyConfig.urlencoded ?? []) {
          if (item.enabled && item.key) {
            params.append(item.key, item.value ?? '');
          }
        }
        return params.toString();
      }
      case 'graphql': {
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
        let parsedVars: Record<string, unknown> = {};
        if (bodyConfig.graphql?.variables?.trim()) {
          try {
            parsedVars = JSON.parse(bodyConfig.graphql.variables);
          } catch {
            throw new BadRequestException('GraphQL variables must be valid JSON');
          }
        }
        return JSON.stringify({
          query: bodyConfig.graphql?.query ?? '',
          variables: parsedVars,
        });
      }
      default:
        return undefined;
    }
  }

  private isBinaryContentType(contentType: string): boolean {
    const lower = contentType.toLowerCase();
    if (!lower) return false;
    return (
      lower.startsWith('image/') ||
      lower.startsWith('audio/') ||
      lower.startsWith('video/') ||
      lower.includes('application/octet-stream') ||
      lower.includes('application/pdf') ||
      lower.includes('application/zip')
    );
  }
}
