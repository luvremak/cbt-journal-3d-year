/**
 * Мінімальний DI-контейнер. Без залежностей від решти застосунку,
 * щоб у Завданні 5 його можна було винести в окрему бібліотеку.
 */

declare const tokenType: unique symbol;

/** Типізований ключ залежності: `resolve(token)` повертає значення типу T. */
export type Token<T> = symbol & { readonly [tokenType]?: T };

export function createToken<T>(description: string): Token<T> {
  return Symbol(description) as Token<T>;
}

export type Factory<T> = (container: Container) => T;

export type Lifetime = 'singleton' | 'transient';

interface Registration {
  factory: Factory<unknown>;
  lifetime: Lifetime;
}

export class DependencyNotRegisteredError extends Error {
  constructor(token: symbol) {
    super(`Dependency not registered: ${token.description ?? token.toString()}`);
    this.name = 'DependencyNotRegisteredError';
  }
}

export class CircularDependencyError extends Error {
  constructor(chain: symbol[]) {
    super(`Circular dependency: ${chain.map((t) => t.description ?? '?').join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}

export class Container {
  private readonly registrations = new Map<symbol, Registration>();
  private readonly singletons = new Map<symbol, unknown>();
  private readonly resolving: symbol[] = [];

  register<T>(token: Token<T>, factory: Factory<T>, lifetime: Lifetime = 'singleton'): this {
    this.registrations.set(token, { factory, lifetime });
    this.singletons.delete(token);
    return this;
  }

  /** Зареєструвати вже готове значення (конфіг, пул з'єднань тощо). */
  registerValue<T>(token: Token<T>, value: T): this {
    this.registrations.set(token, { factory: () => value, lifetime: 'singleton' });
    this.singletons.set(token, value);
    return this;
  }

  has(token: symbol): boolean {
    return this.registrations.has(token);
  }

  resolve<T>(token: Token<T>): T {
    const registration = this.registrations.get(token);
    if (!registration) {
      throw new DependencyNotRegisteredError(token);
    }

    if (registration.lifetime === 'singleton' && this.singletons.has(token)) {
      return this.singletons.get(token) as T;
    }

    if (this.resolving.includes(token)) {
      throw new CircularDependencyError([...this.resolving, token]);
    }

    this.resolving.push(token);
    try {
      const instance = registration.factory(this) as T;
      if (registration.lifetime === 'singleton') {
        this.singletons.set(token, instance);
      }
      return instance;
    } finally {
      this.resolving.pop();
    }
  }
}
