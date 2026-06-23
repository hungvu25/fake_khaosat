import http from 'http';

function checkUrl(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      console.log(`URL ${url} responded with status: ${res.statusCode}`);
      resolve(true);
    }).on('error', (err) => {
      console.error(`URL ${url} failed: ${err.message}`);
      resolve(false);
    });
  });
}

async function main() {
  console.log('Checking local servers...');
  await checkUrl('http://localhost:5000/api/session-status');
  await checkUrl('http://localhost:5173/');
}

main();
