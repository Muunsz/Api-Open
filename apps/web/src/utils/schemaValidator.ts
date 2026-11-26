export interface SchemaValidationError {
  path: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationError[];
}

interface JsonSchemaNode {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  $ref?: string;
}

function resolveRef(node: JsonSchemaNode, root: Record<string, unknown>): JsonSchemaNode {
  if (!node.$ref || !node.$ref.startsWith('#/')) return node;
  const parts = node.$ref.slice(2).split('/');
  let cur: unknown = root;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return node;
    }
  }
  return (cur && typeof cur === 'object' ? cur : node) as JsonSchemaNode;
}

function validateNode(
  value: unknown,
  rawNode: JsonSchemaNode,
  root: Record<string, unknown>,
  path: string,
  errors: SchemaValidationError[],
) {
  const node = resolveRef(rawNode, root);
  if (node.enum && !node.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    errors.push({ path, message: `Expected one of [${node.enum.join(', ')}]` });
  }
  if (node.type) {
    const allowed = Array.isArray(node.type) ? node.type : [node.type];
    const actualType =
      value === null
        ? 'null'
        : Array.isArray(value)
          ? 'array'
          : typeof value === 'number' && Number.isInteger(value) && allowed.includes('integer')
            ? 'integer'
            : typeof value;
    if (!allowed.includes(actualType)) {
      errors.push({ path, message: `Expected type "${allowed.join('|')}", got "${actualType}"` });
      return;
    }
  }
  if (typeof value === 'string') {
    if (node.minLength !== undefined && value.length < node.minLength) {
      errors.push({ path, message: `String length < minLength (${node.minLength})` });
    }
    if (node.maxLength !== undefined && value.length > node.maxLength) {
      errors.push({ path, message: `String length > maxLength (${node.maxLength})` });
    }
  }
  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) {
      errors.push({ path, message: `Number < minimum (${node.minimum})` });
    }
    if (node.maximum !== undefined && value > node.maximum) {
      errors.push({ path, message: `Number > maximum (${node.maximum})` });
    }
  }
  if (Array.isArray(value) && node.items) {
    value.slice(0, 20).forEach((item, idx) => {
      validateNode(item, node.items!, root, `${path}[${idx}]`, errors);
    });
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const reqKey of node.required ?? []) {
      if (!(reqKey in obj)) {
        errors.push({ path: `${path}.${reqKey}`, message: `Missing required property "${reqKey}"` });
      }
    }
    if (node.properties) {
      for (const [k, propSchema] of Object.entries(node.properties)) {
        if (k in obj) {
          validateNode(obj[k], propSchema, root, `${path}.${k}`, errors);
        }
      }
    }
  }
}

export function validateJsonAgainstSchema(
  jsonText: string,
  schemaText: string,
): SchemaValidationResult {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(jsonText);
  } catch {
    return { valid: false, errors: [{ path: '$', message: 'Response body is not valid JSON' }] };
  }
  let schemaObj: Record<string, unknown>;
  try {
    schemaObj = JSON.parse(schemaText) as Record<string, unknown>;
  } catch {
    return { valid: false, errors: [{ path: '$', message: 'Schema is not valid JSON' }] };
  }
  const errors: SchemaValidationError[] = [];
  validateNode(parsedBody, schemaObj as JsonSchemaNode, schemaObj, '$', errors);
  return { valid: errors.length === 0, errors };
}
