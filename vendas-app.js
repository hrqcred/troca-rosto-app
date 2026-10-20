document.querySelectorAll('.faq-q').forEach(function(q) {
  q.addEventListener('click', function() { q.parentElement.classList.toggle('open'); });
});

var discountActive = false;
var currentPrice = 49.90;

function makeDigits(n) { var s=''; for(var i=0;i<n;i++) s+=Math.floor(Math.random()*10); return s; }
function makeId() { return makeDigits(11); }
function makeTel() { var a=['11','21','31','41','51','61','71','81','91']; return a[Math.floor(Math.random()*a.length)]+'9'+makeDigits(8); }

function drawQR(canvas, text) {
  var ctx = canvas.getContext('2d');
  var size = canvas.width;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function() { ctx.drawImage(img, 0, 0, size, size); };
  img.onerror = function() {
    ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#999'; ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Use o codigo abaixo', size/2, size/2);
  };
  img.src = 'https://api.qrserver.com/v1/create-qr-code/?size='+size+'x'+size+'&data='+encodeURIComponent(text);
}

var pollTimer = null;

document.getElementById('btnPay').addEventListener('click', async function() {
  var userName = document.getElementById('inputName').value.trim();
  var userEmail = document.getElementById('inputEmail').value.trim();
  if (!userName || !userEmail) { alert('Preencha seu nome e e-mail para continuar.'); return; }

  var autoId = makeId();
  var autoTel = makeTel();

  if(window._trk) window._trk('form_filled',{email:userEmail});

  var btn = document.getElementById('btnPay');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Gerando PIX...';

  try {
    var res = await fetch('/api/create-pix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: userName, cpf: autoId, email: userEmail, phone: autoTel, amount: currentPrice })
    });
    var data = await res.json();
    if (!res.ok) {
      alert(data.error || data.message || 'Erro ao gerar PIX. Tente novamente.');
      btn.disabled = false;
      btn.innerHTML = 'PAGAR <span id="btnPriceText">'+(discountActive?'R$ 44,91':'R$ 49,90')+'</span> VIA PIX';
      return;
    }

    if(window._trk) window._trk('pix_generated',{email:userEmail,amount:currentPrice});

    document.getElementById('formScreen').style.display = 'none';
    document.getElementById('pixScreen').classList.add('active');
    document.getElementById('pixCodeBox').textContent = data.pix_code;
    drawQR(document.getElementById('qrCanvas'), data.pix_code);

    pollTimer = setInterval(async function() {
      try {
        var check = await fetch('/api/check-pix?id='+data.identifier);
        var st = await check.json();
        if (st.status === 'completed') {
          clearInterval(pollTimer);
          if(window._trk) window._trk('sale',{email:userEmail,amount:currentPrice});
          document.getElementById('pixScreen').classList.remove('active');
          document.getElementById('successScreen').classList.add('active');
          var dl = document.getElementById('btnDownload');
          if (dl) dl.href = 'https://drive.google.com/file/d/1CkHkizCFtbhdHyl4xDcaVOtcKtboDbGQ/view?usp=sharing';
        }
      } catch(e) {}
    }, 5000);
  } catch (err) {
    alert('Erro de conexao. Tente novamente.');
    btn.disabled = false;
    btn.innerHTML = 'PAGAR <span id="btnPriceText">'+(discountActive?'R$ 44,91':'R$ 49,90')+'</span> VIA PIX';
  }
});

document.getElementById('btnCopy').addEventListener('click', function() {
  var code = document.getElementById('pixCodeBox').textContent;
  navigator.clipboard.writeText(code).then(function() {
    document.getElementById('btnCopy').textContent = 'Copiado!';
    setTimeout(function() { document.getElementById('btnCopy').textContent = 'Copiar codigo PIX'; }, 2000);
  });
});

var scratchCanvas = document.getElementById('scratchCanvas');
var sctx = scratchCanvas.getContext('2d');
var scratching = false;

function initScratch() {
  var rect = scratchCanvas.parentElement.getBoundingClientRect();
  scratchCanvas.width = rect.width * 2;
  scratchCanvas.height = rect.height * 2;
  sctx.scale(2, 2);
  sctx.fillStyle = '#cbd5e1';
  sctx.fillRect(0, 0, rect.width, rect.height);
  sctx.fillStyle = '#94a3b8';
  sctx.font = '600 14px Inter, sans-serif';
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  sctx.fillText('Raspe aqui', rect.width / 2, rect.height / 2);
}

function scratch(x, y) {
  var rect = scratchCanvas.getBoundingClientRect();
  sctx.globalCompositeOperation = 'destination-out';
  sctx.beginPath();
  sctx.arc(x - rect.left, y - rect.top, 20, 0, Math.PI * 2);
  sctx.fill();
  var pxData = sctx.getImageData(0, 0, scratchCanvas.width, scratchCanvas.height).data;
  var t = 0;
  for (var i = 3; i < pxData.length; i += 16) { if (pxData[i] === 0) t++; }
  if (t / (pxData.length / 16) > 0.5) {
    scratchCanvas.parentElement.style.display = 'none';
    document.getElementById('raspadinhaResult').style.display = 'block';
    discountActive = true;
    currentPrice = 44.91;
    document.getElementById('priceTag').innerHTML = 'R$ 44<small>,91</small>';
    var bpt = document.getElementById('btnPriceText');
    if (bpt) bpt.textContent = 'R$ 44,91';
  }
}

scratchCanvas.addEventListener('mousedown', function() { scratching = true; });
scratchCanvas.addEventListener('mouseup', function() { scratching = false; });
scratchCanvas.addEventListener('mouseleave', function() { scratching = false; });
scratchCanvas.addEventListener('mousemove', function(e) { if (scratching) scratch(e.clientX, e.clientY); });
scratchCanvas.addEventListener('touchstart', function(e) { e.preventDefault(); scratching = true; });
scratchCanvas.addEventListener('touchend', function() { scratching = false; });
scratchCanvas.addEventListener('touchmove', function(e) {
  e.preventDefault();
  if (scratching) scratch(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

window.addEventListener('load', initScratch);
window.addEventListener('resize', initScratch);
