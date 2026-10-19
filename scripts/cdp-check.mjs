import { WebSocket } from 'ws';
const targetId = process.argv[2];
const expr = process.argv[3];
const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/' + targetId);
ws.on('open', () => {
    ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{expression:expr}}));
});
ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id === 1) {
        console.log(msg.result && msg.result.result ? msg.result.result.value : JSON.stringify(msg.result));
        ws.close();
    }
});
setTimeout(() => { ws.close(); process.exit(0); }, 8000);
