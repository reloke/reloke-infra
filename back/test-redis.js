
const { createClient } = require('redis');

async function test() {
    const client = createClient();
    client.on('error', (err) => console.log('Redis Error', err));
    await client.connect();
    console.log('Connected to Redis');

    await client.publish('test-channel', 'hello world');
    console.log('Published message');

    await client.disconnect();
}

test().catch(console.error);
