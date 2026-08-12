const form = document.querySelector('#qr-form');
const result = document.querySelector('#qr-result');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Creating…';
  result.hidden = false;
  result.textContent = '';

  try {
    const payload = {
      destination: document.querySelector('#destination').value,
      label: document.querySelector('#label').value,
      tracking: document.querySelector('#tracking').checked
    };
    const response = await fetch('/api/qr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to create the QR code.');

    const image = document.createElement('img');
    image.src = data.qrDataUrl;
    image.alt = 'Generated QR code';
    const heading = document.createElement('strong');
    heading.textContent = data.tracking ? 'Tracked QR code ready' : 'QR code ready';
    const encoded = document.createElement('code');
    encoded.textContent = data.redirectUrl || data.destination;
    const download = document.createElement('a');
    download.className = 'download';
    download.href = data.qrDataUrl;
    download.download = data.code ? `parent-data-force-qr-${data.code}.png` : 'parent-data-force-qr.png';
    download.textContent = 'Download PNG ↓';
    result.replaceChildren(heading, image, encoded, download);
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'error';
    message.textContent = error.message;
    result.replaceChildren(message);
  } finally {
    button.disabled = false;
    button.textContent = 'Generate QR code';
  }
});
