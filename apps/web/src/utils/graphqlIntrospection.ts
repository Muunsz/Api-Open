export const GRAPHQL_INTROSPECTION_QUERY = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      kind
      name
      fields(includeDeprecated: true) {
        name
        description
        args {
          name
          type {
            kind
            name
            ofType {
              kind
              name
              ofType { kind name }
            }
          }
        }
        type {
          kind
          name
          ofType {
            kind
            name
            ofType { kind name }
          }
        }
      }
    }
  }
}`;

export interface GqlFieldSummary {
  name: string;
  args: string;
  returnType: string;
  description?: string;
}

interface GqlTypeRef {
  kind?: string;
  name?: string | null;
  ofType?: GqlTypeRef | null;
}

function formatTypeRef(ref?: GqlTypeRef | null): string {
  if (!ref) return 'Unknown';
  if (ref.kind === 'NON_NULL') return `${formatTypeRef(ref.ofType)}!`;
  if (ref.kind === 'LIST') return `[${formatTypeRef(ref.ofType)}]`;
  return ref.name || 'Unknown';
}

export function parseIntrospectionResponse(jsonStr: string): {
  queries: GqlFieldSummary[];
  mutations: GqlFieldSummary[];
} {
  const parsed = JSON.parse(jsonStr) as {
    data?: {
      __schema?: {
        queryType?: { name?: string };
        mutationType?: { name?: string };
        types?: Array<{
          name?: string;
          fields?: Array<{
            name: string;
            description?: string;
            args?: Array<{ name: string; type: GqlTypeRef }>;
            type: GqlTypeRef;
          }>;
        }>;
      };
    };
  };

  const schema = parsed?.data?.__schema;
  if (!schema) throw new Error('Invalid GraphQL introspection response');

  const extractFields = (typeName?: string): GqlFieldSummary[] => {
    if (!typeName) return [];
    const found = schema.types?.find((t) => t.name === typeName);
    return (found?.fields ?? []).map((f) => ({
      name: f.name,
      description: f.description,
      args: (f.args ?? [])
        .map((a) => `${a.name}: ${formatTypeRef(a.type)}`)
        .join(', '),
      returnType: formatTypeRef(f.type),
    }));
  };

  return {
    queries: extractFields(schema.queryType?.name),
    mutations: extractFields(schema.mutationType?.name),
  };
}
