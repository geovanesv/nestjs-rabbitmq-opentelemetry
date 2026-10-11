// Testes unitários do helper de extração de contexto (RFC §7.6 / F-36 / FR-024).
// Determinísticos, sem broker/collector/rede.
import { describe, expect, it } from '@jest/globals';
import { extractTraceHeaders } from '../src/tracing/extract-trace-context';

describe('extractTraceHeaders', () => {
  it('extrai traceparent de source.headers', () => {
    const headers = {
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      pattern: 'order.created',
    };
    expect(extractTraceHeaders({ headers })).toEqual({
      traceparent: headers.traceparent,
    });
  });

  it('extrai de source.properties.headers', () => {
    const headers = {
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    };
    expect(extractTraceHeaders({ properties: { headers } })).toEqual({
      traceparent: headers.traceparent,
    });
  });

  it('retorna {} sem lançar para entrada sem headers', () => {
    expect(extractTraceHeaders({})).toEqual({});
    expect(extractTraceHeaders(null)).toEqual({});
    expect(extractTraceHeaders(undefined)).toEqual({});
    expect(extractTraceHeaders('not-an-object')).toEqual({});
  });

  it('ignora valores não-string', () => {
    expect(
      extractTraceHeaders({
        headers: {
          traceparent: '00-abc-1',
          tracestate: 123,
          baggage: true,
        },
      }),
    ).toEqual({ traceparent: '00-abc-1' });
  });

  it('preserva tracestate, baggage e ot-tracer-*', () => {
    const headers = {
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      tracestate: 'congo=t61rcWkgMzE',
      baggage: 'userId=123',
      'ot-tracer-spanid': 'b7ad6b7169203331',
      'content-type': 'application/json',
    };
    expect(extractTraceHeaders({ headers })).toEqual({
      traceparent: headers.traceparent,
      tracestate: headers.tracestate,
      baggage: headers.baggage,
      'ot-tracer-spanid': headers['ot-tracer-spanid'],
    });
  });
});