import { describe, expect, it, vi } from 'vitest';
import {
  CircularDependencyError,
  Container,
  createToken,
  DependencyNotRegisteredError,
} from '../../src/lib/di/container.js';

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
