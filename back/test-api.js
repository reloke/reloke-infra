const axios = require('axios');

async function test() {
    try {
        console.log('Testing GET http://localhost:3000/admin/test-kyc ...');
        const resp = await axios.get('http://localhost:3000/admin/test-kyc');
        console.log('Status:', resp.status);
        console.log('Total:', resp.data.total);
        console.log('Items Count:', resp.data.items?.length);
        if (resp.data.items?.length > 0) {
            console.log('First Item:', JSON.stringify(resp.data.items[0], null, 2));
        }
    } catch (err) {
        console.error('Error:', err.message);
        if (err.response) {
            console.error('Data:', err.response.data);
        }
    }
}

test();
