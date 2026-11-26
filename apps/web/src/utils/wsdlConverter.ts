import type { HttpMethod } from '@api-open/shared';
import type { ApiRequestDto } from '../api/workspace';
import type { ImportedCollectionNode } from './postmanConverter';

/**
 * Parses a WSDL 1.1 / 2.0 XML document into an Api-Open Collection with
 * ready-to-send SOAP XML envelopes and SOAPAction headers.
 */
export function parseWsdlSpec(xmlText: string): ImportedCollectionNode {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid WSDL XML document');
  }

  const defs =
    doc.querySelector('definitions') ||
    doc.getElementsByTagNameNS('*', 'definitions')[0];
  const serviceName =
    defs?.getAttribute('name') ||
    doc.getElementsByTagNameNS('*', 'service')[0]?.getAttribute('name') ||
    'SOAP Service';

  const targetNamespace = defs?.getAttribute('targetNamespace') || 'http://tempuri.org/';

  const soapAddress =
    doc.getElementsByTagNameNS('*', 'address')[0]?.getAttribute('location') ||
    '{{soap_endpoint}}';

  const operations = Array.from(
    doc.getElementsByTagNameNS('*', 'operation'),
  );

  const seen = new Set<string>();
  const requests: Array<Omit<ApiRequestDto, 'id' | 'collectionId'>> = [];

  for (const op of operations) {
    const opName = op.getAttribute('name')?.trim();
    if (!opName || seen.has(opName)) continue;
    seen.add(opName);

    const soapAction =
      op.getAttribute('soapAction') || `${targetNamespace.replace(/\/$/, '')}/${opName}`;

    const envelope = [
      '<?xml version="1.0" encoding="utf-8"?>',
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="${targetNamespace}">`,
      '  <soapenv:Header/>',
      '  <soapenv:Body>',
      `    <tns:${opName}>`,
      '      <!-- Add operation parameters here -->',
      `    </tns:${opName}>`,
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n');

    requests.push({
      name: opName,
      method: 'POST' as HttpMethod,
      url: soapAddress,
      headers: [
        {
          id: Math.random().toString(36).slice(2, 10),
          key: 'Content-Type',
          value: 'text/xml; charset=utf-8',
          enabled: true,
        },
        {
          id: Math.random().toString(36).slice(2, 10),
          key: 'SOAPAction',
          value: `"${soapAction}"`,
          enabled: true,
        },
      ],
      queryParams: [],
      auth: { type: 'none' },
      body: { mode: 'raw', raw: envelope, rawType: 'xml' },
    });
  }

  return {
    name: `${serviceName} (SOAP)`,
    folders: [],
    requests,
  };
}
