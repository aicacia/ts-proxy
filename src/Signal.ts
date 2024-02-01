export type SignalListener<T> = (value: T) => void;

export class Signal<T> {
	protected listeners: SignalListener<T>[] = [];

	listen(listener: SignalListener<T>) {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index !== -1) {
				this.listeners.splice(index, 1);
			}
		};
	}

	signal(value: T) {
		for (const listener of this.listeners) {
			listener(value);
		}
	}
}
