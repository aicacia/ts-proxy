import { Signal, type SignalListener } from './Signal';

export const METADATA_SYMBOL = Symbol('$metadata');

export type ProxyObject = Record<string | symbol, unknown> | Array<unknown>;

export interface Metadata<T = ProxyObject> {
	target: T;
	isArray: boolean;
	proxy: ProxyValue<T>;
	signal: Signal<ProxyValue<T>>;
	children: Map<keyof T, Signal<T[keyof T]>>;
	parents: Set<ProxyValue>;
}

export type ProxyValue<T = ProxyObject> = T & {
	[METADATA_SYMBOL]: Metadata<T>;
};

export function proxy<T>(value: T) {
	return createProxy(value);
}

export function unproxy<T>(value: T) {
	return unproxyRecur(value);
}

export function isProxy<T>(value: T): value is ProxyValue<T> {
	return typeof value === 'object' && value != null && METADATA_SYMBOL in value;
}

export function signal<T extends ProxyObject = ProxyObject>(target: T) {
	if (isProxy(target)) {
		signalTarget(target);
	}
}

export function signalFrom<T extends ProxyObject = ProxyObject>(
	target: T,
	key: keyof T,
	value: T[keyof T]
) {
	if (isProxy(target)) {
		const metadata = target[METADATA_SYMBOL];
		if (metadata !== undefined) {
			let signal = metadata.children.get(key);
			if (signal === undefined) {
				signal = new Signal();
				metadata.children.set(key, signal);
			}
			signal.signal(value);
			signalMetadata(metadata);
		}
	}
}

export function listen<T extends ProxyObject = ProxyObject>(value: T, listener: SignalListener<T>) {
	if (isProxy(value)) {
		const metadata = value[METADATA_SYMBOL];
		if (metadata !== undefined) {
			return metadata.signal.listen(listener);
		}
	}
	throw new Error('Cannot listen to non-proxy value');
}

export function listenTo<T extends ProxyObject = ProxyObject>(
	value: T,
	key: keyof T,
	listener: SignalListener<T[keyof T]>
) {
	if (isProxy(value)) {
		const metadata = value[METADATA_SYMBOL];
		if (metadata !== undefined) {
			let signal = metadata.children.get(key);
			if (signal === undefined) {
				signal = new Signal();
				metadata.children.set(key, signal);
			}
			return signal.listen(listener);
		}
	}
	throw new Error('Cannot listen to non-proxy value');
}

let trackingListener: ((state: unknown) => void) | undefined;
const trackingUnlistens: (() => void)[] = [];
export function track(action: () => void, listener: (state: unknown) => void): () => void {
	if (trackingListener !== undefined) {
		action();
		return () => undefined;
	}
	try {
		trackingListener = listener;
		action();
		const unlistens = trackingUnlistens.slice();
		return () => {
			for (const unlisten of unlistens) {
				unlisten();
			}
		};
	} finally {
		trackingListener = undefined;
	}
}

function createProxy<T>(value: T, parent?: ProxyValue) {
	if (value != null && typeof value === 'object') {
		const metadata = (value as ProxyValue)[METADATA_SYMBOL];
		if (metadata !== undefined) {
			if (parent !== undefined) {
				metadata.parents.add(parent);
			}
			return metadata.proxy as ProxyValue<T>;
		} else {
			const proxy = new Proxy(value as ProxyValue, handler);
			const parents = new Set();
			if (parent !== undefined) {
				parents.add(parent);
			}
			Object.defineProperty(value, METADATA_SYMBOL, {
				value: {
					target: value,
					isArray: Array.isArray(value),
					proxy,
					signal: new Signal<ProxyValue>(),
					parents,
					children: new Map()
				},
				writable: false
			});
			return proxy as ProxyValue<T>;
		}
	}
	return value;
}

function unproxyRecur<T>(value: T, alreadyUnproxied = new Map()): T {
	const unproxied = alreadyUnproxied.get(value);
	if (unproxied !== undefined) {
		return unproxied as T;
	}
	if (isProxy(value)) {
		const metadata = value[METADATA_SYMBOL];
		if (metadata !== undefined) {
			if (metadata.isArray) {
				const array: unknown[] = [];
				alreadyUnproxied.set(metadata.target, array);
				for (const item of metadata.target as Iterable<unknown>) {
					array.push(unproxyRecur(item, alreadyUnproxied));
				}
				return array as T;
			} else {
				const object: Record<string | symbol, Iterable<unknown>> = {};
				alreadyUnproxied.set(metadata.target, object);
				for (const [key, child] of Object.entries(metadata.target as object)) {
					object[key] = unproxyRecur(child, alreadyUnproxied);
				}
				return object as T;
			}
		}
	}
	return value;
}

function removeChild(parent: ProxyValue, key: string | symbol, child: unknown) {
	if (isProxy(child)) {
		const metadata = child[METADATA_SYMBOL];
		if (metadata !== undefined) {
			metadata.parents.delete(parent);
			const parentMetadata = parent[METADATA_SYMBOL];
			if (parentMetadata !== undefined) {
				const signal = parentMetadata.children.get(key as never);
				if (signal !== undefined) {
					parentMetadata.children.delete(key as never);
				}
			}
		}
	}
}

function signalTarget<T extends ProxyObject = ProxyObject>(target: ProxyValue<T>) {
	const metadata = target[METADATA_SYMBOL];
	if (metadata !== undefined) {
		signalMetadata(metadata);
	}
}

function signalMetadata<T extends ProxyObject = ProxyObject>(metadata: Metadata<T>) {
	metadata.signal.signal(metadata.proxy);
	for (const parent of metadata.parents) {
		const parentMetadata = parent[METADATA_SYMBOL];
		if (parentMetadata !== undefined) {
			signalTarget(parentMetadata.target as ProxyValue<T>);
		}
	}
}

const handler: ProxyHandler<ProxyValue> = {
	defineProperty(target, prop, descriptor) {
		descriptor.value = createProxy(descriptor.value, target);
		if (descriptor.value != null) {
			const valueMetadata: Metadata = descriptor.value[METADATA_SYMBOL];
			if (valueMetadata !== undefined) {
				valueMetadata.parents.add(target);
			}
		}
		return Reflect.defineProperty(target, prop, descriptor);
	},

	deleteProperty(target, prop) {
		const metadata = target[METADATA_SYMBOL];
		const hasMetadata = metadata !== undefined;
		const value = hasMetadata ? Reflect.get(target, prop, target) : undefined;
		const boolean = Reflect.deleteProperty(target, prop);

		if (boolean && hasMetadata) {
			signalFrom(target, prop as never, value);
			removeChild(target, prop, value);
		}

		return boolean;
	},

	get(target, prop, receiver) {
		if (prop === METADATA_SYMBOL) {
			return target[METADATA_SYMBOL];
		}
		const value = createProxy(Reflect.get(target, prop, receiver), target);
		if (trackingListener !== undefined) {
			const metadata = target[METADATA_SYMBOL];
			if (metadata !== undefined) {
				trackingUnlistens.push(listenTo(metadata.target, prop as never, trackingListener));
			}
		}
		return value;
	},

	has(target, prop) {
		if (prop === METADATA_SYMBOL) {
			return true;
		}
		return Reflect.has(target, prop);
	},

	set(target, prop, value, receiver) {
		if (prop === METADATA_SYMBOL) {
			return false;
		}
		const proxyValue = createProxy(value, target);
		const boolean = Reflect.set(target, prop, proxyValue, receiver);
		signalFrom(target, prop as never, proxyValue);
		return boolean;
	},

	setPrototypeOf() {
		throw new Error('Cannot set prototype of $metadata object');
	}
};
