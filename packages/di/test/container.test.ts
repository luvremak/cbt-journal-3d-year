import { describe, expect, it, vi } from 'vitest';
import {
  CircularDependencyError,
  Container,
  ContainerDisposedError,
  createToken,
  DependencyNotRegisteredError,
} from '../src/index.js';

const A = createToken<{ n: number }>('A');
const B = createToken<{ a: { n: number } }>('B');

describe('DI Container', () => {
  it('resolves a registered factory and passes the container to it', () => {
    const c = new Container();
    c.register(A, () => ({ n: 1 }));
    c.register(B, (container) => ({ a: container.resolve(A) }));
    expect(c.resolve(B).a.n).toBe(1);
  });

  it('singleton (default) calls the factory once', () => {
    const c = new Container();
    const factory = vi.fn(() => ({ n: 1 }));
    c.register(A, factory);
    expect(c.resolve(A)).toBe(c.resolve(A));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('transient calls the factory on every resolve', () => {
    const c = new Container();
    const factory = vi.fn(() => ({ n: 1 }));
    c.register(A, factory, 'transient');
    expect(c.resolve(A)).not.toBe(c.resolve(A));
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('re-register drops the cached singleton', () => {
    const c = new Container();
    c.register(A, () => ({ n: 1 }));
    expect(c.resolve(A).n).toBe(1);
    c.register(A, () => ({ n: 2 }));
    expect(c.resolve(A).n).toBe(2);
  });

  it('transient is never cached, even after a singleton was re-registered as transient', () => {
    const c = new Container();
    c.register(A, () => ({ n: 1 }));
    c.resolve(A);
    c.register(A, () => ({ n: 2 }), 'transient');
    const first = c.resolve(A);
    expect(c.resolve(A)).not.toBe(first);
  });

  it('registerValue returns exactly that value', () => {
    const c = new Container();
    const value = { n: 7 };
    c.registerValue(A, value);
    expect(c.resolve(A)).toBe(value);
    expect(c.resolve(A)).toBe(value);
  });

  it('register returns the container for chaining', () => {
    const c = new Container();
    expect(c.register(A, () => ({ n: 1 }))).toBe(c);
    expect(c.registerValue(B, { a: { n: 1 } })).toBe(c);
  });

  it('has() reports registration', () => {
    const c = new Container();
    expect(c.has(A)).toBe(false);
    c.register(A, () => ({ n: 1 }));
    expect(c.has(A)).toBe(true);
  });

  it('throws DependencyNotRegisteredError with the token name', () => {
    const c = new Container();
    expect(() => c.resolve(A)).toThrow(DependencyNotRegisteredError);
    expect(() => c.resolve(A)).toThrow('Dependency not registered: A');
  });

  it('detects circular dependencies and names the chain', () => {
    const c = new Container();
    c.register(A, (x) => x.resolve(B) as unknown as { n: number });
    c.register(B, (x) => ({ a: x.resolve(A) }));
    expect(() => c.resolve(A)).toThrow(CircularDependencyError);
    expect(() => c.resolve(A)).toThrow('Circular dependency: A -> B -> A');
  });

  it('can resolve again after a failed factory (resolving stack is cleaned)', () => {
    const c = new Container();
    let fail = true;
    c.register(A, () => {
      if (fail) throw new Error('boom');
      return { n: 1 };
    });
    expect(() => c.resolve(A)).toThrow('boom');
    fail = false;
    expect(c.resolve(A).n).toBe(1);
  });

  it('error names are set for logging', () => {
    expect(new DependencyNotRegisteredError(A).name).toBe('DependencyNotRegisteredError');
    expect(new CircularDependencyError([A]).name).toBe('CircularDependencyError');
  });

  it('uses "?" / toString for tokens without description', () => {
    const anon = Symbol() as ReturnType<typeof createToken<number>>;
    expect(new DependencyNotRegisteredError(anon).message).toBe(
      'Dependency not registered: Symbol()',
    );
    expect(new CircularDependencyError([anon]).message).toBe('Circular dependency: ?');
  });
});

describe('register options', () => {
  it('accepts an options object with lifetime', () => {
    const c = new Container();
    c.register(A, () => ({ n: 1 }), { lifetime: 'transient' });
    expect(c.resolve(A)).not.toBe(c.resolve(A));
    c.register(A, () => ({ n: 1 }), {});
    expect(c.resolve(A)).toBe(c.resolve(A));
  });

  it('dispose is only allowed for singletons', () => {
    const c = new Container();
    expect(() =>
      c.register(A, () => ({ n: 1 }), { lifetime: 'transient', dispose: () => {} }),
    ).toThrow(new TypeError('dispose is only supported for singletons (A)'));
    expect(c.has(A)).toBe(false);
  });
});

describe('Container.dispose', () => {
  it('disposes created singletons in reverse creation order, with their instances', async () => {
    const c = new Container();
    const calls: string[] = [];
    c.register(A, () => ({ n: 1 }), { dispose: (a) => void calls.push(`A:${a.n}`) });
    c.register(B, (x) => ({ a: x.resolve(A) }), {
      dispose: async (b) => {
        await Promise.resolve();
        calls.push(`B:${b.a.n}`);
      },
    });
    c.resolve(B); // створює A, потім B
    await c.dispose();
    expect(calls).toEqual(['B:1', 'A:1']);
  });

  it('skips registrations that were never resolved or have no dispose', async () => {
    const c = new Container();
    const disposeA = vi.fn();
    c.register(A, () => ({ n: 1 }), { dispose: disposeA });
    c.register(B, () => ({ a: { n: 2 } }));
    c.resolve(B);
    await c.dispose();
    expect(disposeA).not.toHaveBeenCalled();
  });

  it('registerValue can carry a dispose callback', async () => {
    const c = new Container();
    const value = { n: 5 };
    const dispose = vi.fn();
    c.registerValue(A, value, { dispose });
    c.resolve(A);
    await c.dispose();
    expect(dispose).toHaveBeenCalledWith(value);
  });

  it('is idempotent and blocks resolve afterwards', async () => {
    const c = new Container();
    const dispose = vi.fn();
    c.register(A, () => ({ n: 1 }), { dispose });
    c.resolve(A);
    await c.dispose();
    await c.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => c.resolve(A)).toThrow(ContainerDisposedError);
    expect(() => c.resolve(A)).toThrow('Container is disposed; cannot resolve A');
    expect(new ContainerDisposedError(A).name).toBe('ContainerDisposedError');
  });

  it('runs every dispose even if some fail, then reports all failures', async () => {
    const c = new Container();
    const C = createToken<number>('C');
    const ok = vi.fn();
    c.register(A, () => ({ n: 1 }), {
      dispose: () => {
        throw new Error('a failed');
      },
    });
    c.register(B, () => ({ a: { n: 2 } }), { dispose: ok });
    c.register(C, () => 3, {
      dispose: () => Promise.reject(new Error('c failed')),
    });
    c.resolve(A);
    c.resolve(B);
    c.resolve(C);
    const error = await c.dispose().then(
      () => null,
      (e: unknown) => e,
    );
    expect(ok).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).message).toBe('2 dispose callback(s) failed');
    expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual([
      'c failed',
      'a failed',
    ]);
  });

  it('re-registering a created singleton drops it from disposal', async () => {
    const c = new Container();
    const first = vi.fn();
    const second = vi.fn();
    c.register(A, () => ({ n: 1 }), { dispose: first });
    c.resolve(A);
    c.register(A, () => ({ n: 2 }), { dispose: second });
    await c.dispose();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled(); // новий екземпляр ще не створювали
  });

  it('re-registering keeps disposal of other singletons intact', async () => {
    const c = new Container();
    const disposeB = vi.fn();
    c.register(B, () => ({ a: { n: 0 } }), { dispose: disposeB });
    c.register(A, () => ({ n: 1 }), { dispose: () => {} });
    c.resolve(B);
    c.resolve(A);
    c.register(A, () => ({ n: 2 }));
    await c.dispose();
    expect(disposeB).toHaveBeenCalledTimes(1);
  });

  it('re-registering a never-resolved token does not affect other disposals', async () => {
    const c = new Container();
    const disposeB = vi.fn();
    c.register(B, () => ({ a: { n: 0 } }), { dispose: disposeB });
    c.resolve(B);
    c.register(A, () => ({ n: 1 }));
    c.register(A, () => ({ n: 2 }));
    await c.dispose();
    expect(disposeB).toHaveBeenCalledTimes(1);
  });
});
