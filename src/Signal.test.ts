import tape from 'tape';
import { Signal } from './Signal';

tape('Signal listen/unlisten', (assert: tape.Test) => {
	const signal = new Signal<number>();
	let result = 0;
	const unlisten = signal.listen((value) => {
		result = value;
	});
	signal.signal(1);
	unlisten();
	assert.doesNotThrow(unlisten);
	signal.signal(2);
	assert.equal(result, 1);
	assert.end();
});
