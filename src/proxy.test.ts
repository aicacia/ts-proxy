import tape from 'tape';
import { listen, proxy, track, unproxy } from './proxy';

interface Item {
	id: number;
	msg?: string;
}

tape('proxy object', (assert: tape.Test) => {
	const object = proxy<{ items: Item[] }>({ items: [{ id: 0 }] });
	const objects: Array<typeof object> = [];
	const unlisten = listen(object, (state) => {
		objects.push(unproxy(state));
	});
	object.items[0].id = 1;
	assert.deepEqual(objects[0], { items: [{ id: 1 }] }, 'should update the id');

	object.items.push({ id: 2, msg: 'Hello, world!' });
	assert.deepEqual(
		objects[1],
		{ items: [{ id: 1 }, { id: 2, msg: 'Hello, world!' }] },
		'should push new item'
	);

	delete object.items[1].msg;
	assert.deepEqual(objects[3], { items: [{ id: 1 }, { id: 2 }] }, 'should delete item msg');

	unlisten();
	assert.end();
});

tape('proxy array', (assert: tape.Test) => {
	const array = proxy<Item[]>([{ id: 0 }]);
	const arrays: Array<typeof array> = [];
	const unlisten = listen(array, (state) => {
		arrays.push(unproxy(state));
	});
	array[0].id = 1;
	assert.deepEqual(arrays[0], [{ id: 1 }], 'should update the id');

	array.push({ id: 2, msg: 'Hello, world!' });
	assert.deepEqual(arrays[1], [{ id: 1 }, { id: 2, msg: 'Hello, world!' }], 'should push new item');

	delete array[1].msg;
	assert.deepEqual(arrays[3], [{ id: 1 }, { id: 2 }], 'should delete item msg');

	unlisten();
	assert.end();
});

tape('proxy tracking', (assert: tape.Test) => {
	const object = proxy<{ items: Item[] }>({ items: [{ id: 1 }] });

	let changed = false;
	const unlisten = track(
		() => {
			assert.equals(object.items.length, 1);
		},
		() => {
			changed = true;
		}
	);

	object.items.push({ id: 2 });

	assert.equals(changed, true, 'should track changes');

	unlisten();
	assert.end();
});
