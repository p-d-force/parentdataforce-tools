// Mock webhook receiver for testing scan notifications
import http from 'node:http';

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        console.log('=== WEBHOOK RECEIVED ===');
        console.log('username:', parsed.username);
        console.log('embed title:', parsed.embeds?.[0]?.title);
        parsed.embeds?.[0]?.fields?.forEach((f) => console.log(`  ${f.name}: ${f.value}`));
        console.log('timestamp:', parsed.embeds?.[0]?.timestamp);
      } catch (e) {
        console.log('=== RAW (not JSON):', body.slice(0, 200));
      }
      res.writeHead(204);
      res.end();
    });
  } else {
    res.writeHead(200);
    res.end('webhook receiver up');
  }
});

server.listen(3999, '127.0.0.1', () => {
  console.log('Mock webhook receiver listening on http://127.0.0.1:3999');
});
