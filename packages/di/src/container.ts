/**
 * Мінімальний типізований DI-контейнер без залежностей.
 */

declare const tokenType: unique symbol;

/** Типізований ключ залежності: `resolve(token)` повертає значення типу T. */
export type Token<T> = symbol & { readonly [tokenType]?: T };

export function createToken<T>(description: string): Token<T> {
  return Symbol(description) as Token<T>;
}

export type Factory<T> = (container: Container) => T;

export type Lifetime = 'singleton' | 'transient';

export interface RegisterOptions<T> {
  /** singleton (за замовчуванням) — один екземпляр; transient — новий на кожен resolve. */
  lifetime?: Lifetime;
  /** Звільнення ресурсу в `container.dispose()`. Лише для singleton. */
  dispose?: (instance: T) => void | Promise<void>;
}

interface Registration {
  factory: Factory<unknown>;
  lifetime: Lifetime;
  dispose?: (instance: unknown) => void | Promise<void>;
}

const describe = (token: symbol) => token.description ?? token.toString();

export class DependencyNotRegisteredError extends Error {
  constructor(token: symbol) {
    super(`Dependency not registered: ${describe(token)}`);
    this.name = 'DependencyNotRegisteredError';
  }
}

export class CircularDependencyError extends Error {
  constructor(chain: symbol[]) {
    super(`Circular dependency: ${chain.map((t) => t.description ?? '?').join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}

export class ContainerDisposedError extends Error {
  constructor(token: symbol) {
    super(`Container is disposed; cannot resolve ${describe(token)}`);
    this.name = 'ContainerDisposedError';
  }
}

export class Container {
  private readonly registrations = new Map<symbol, Registration>();
  private readonly singletons = new Map<symbol, unknown>();
  /** Створені singleton-и з dispose, у порядку створення — звільняємо у зворотному. */
  private readonly toDispose: { token: symbol; dispose: () => void | Promise<void> }[] = [];
  private readonly resolving: symbol[] = [];
  private disposed = false;

  register<T>(
    token: Token<T>,
    factory: Factory<T>,
    options: Lifetime | RegisterOptions<T> = {},
  ): this {
    const { lifetime = 'singleton', dispose } =
      typeof options === 'string' ? { lifetime: options } : options;
    if (dispose && lifetime !== 'singleton') {
      throw new TypeError(`dispose is only supported for singletons (${describe(token)})`);
    }
    this.registrations.set(token, {
      factory,
      lifetime,
      dispose: dispose as Registration['dispose'],
    });
    // Перереєстрація скидає вже створений екземпляр (його dispose не викликається —
    // перереєстровуйте до першого resolve, як у тестах і composition root).
    this.singletons.delete(token);
    const index = this.toDispose.findIndex((d) => d.token === token);
    if (index >= 0) this.toDispose.splice(index, 1);
    return this;
  }

  /** Зареєструвати вже готове значення (конфіг, пул з'єднань тощо). */
  registerValue<T>(
    token: Token<T>,
    value: T,
    options: Pick<RegisterOptions<T>, 'dispose'> = {},
  ): this {
    return this.register(token, () => value, options);
  }

  has(token: symbol): boolean {
    return this.registrations.has(token);
  }

  resolve<T>(token: Token<T>): T {
    if (this.disposed) {
      throw new ContainerDisposedError(token);
    }
    const registration = this.registrations.get(token);
    if (!registration) {
      throw new DependencyNotRegisteredError(token);
    }

    // У кеші лежать лише singleton-и (див. нижче).
    if (this.singletons.has(token)) {
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
        const { dispose } = registration;
        if (dispose) this.toDispose.push({ token, dispose: () => dispose(instance) });
      }
      return instance;
    } finally {
      this.resolving.pop();
    }
  }

  /**
   * Звільняє створені singleton-и з `dispose` у зворотному порядку створення
   * (залежність закривається після того, хто нею користувався). Повторний виклик
   * нічого не робить; resolve після dispose кидає ContainerDisposedError.
   * Якщо кілька dispose впали — решта все одно виконуються, а помилки збираються
   * в AggregateError.
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    const errors: unknown[] = [];
    for (const { dispose } of this.toDispose.splice(0).reverse()) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    // Відпускаємо посилання для збирача сміття; через API це не спостерігається.
    // Stryker disable next-line CallExpression: еквівалентний — після dispose resolve недоступний.
    this.singletons.clear();
    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} dispose callback(s) failed`);
    }
  }
}
