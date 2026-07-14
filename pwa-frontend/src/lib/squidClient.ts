/**
 * @deprecated Squid backend has been archived. Use tools-api via apiClient instead.
 */
export function getSquid(): never {
  throw new Error('Squid backend is archived. Use tools-api endpoints via apiClient.');
}

export function collection(_name: string): never {
  throw new Error('Squid backend is archived. Use tools-api endpoints via apiClient.');
}

export function executable(_serviceName: string, _functionName: string): (...args: unknown[]) => Promise<never> {
  return async () => {
    throw new Error(`Squid backend is archived. ${_serviceName}.${_functionName} is no longer available.`);
  };
}
