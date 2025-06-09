// Seletores de elementos DOM
const cam = document.getElementById('camera');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const captureBtn = document.getElementById('captureBtn');
const genBtn = document.getElementById('generatePdfBtn');
const list = document.getElementById('docsList');
const progBar = document.getElementById('progressBar');
const prog = document.getElementById('progress');

let docs = [];

// Persistência e renderização
function saveRender() {
  localStorage.setItem('docs', JSON.stringify(docs));
  renderList();
}

function renderList() {
  list.innerHTML = '';
  docs.forEach((doc, i) => {
    const div = document.createElement('div');
    div.className = 'doc';

    const img = document.createElement('img');
    img.src = doc.img;
    img.alt = `Documento ${i + 1}`;
    img.title = 'Clique para ampliar';
    img.onclick = () => window.open(doc.img, '_blank');

    const textarea = document.createElement('textarea');
    textarea.value = doc.text || '';
    textarea.placeholder = 'Texto reconhecido...';
    textarea.onchange = () => {
      docs[i].text = textarea.value;
      saveRender();
    };

    const del = document.createElement('button');
    del.textContent = '🗑️';
    del.onclick = () => {
      docs.splice(i, 1);
      saveRender();
    };

    div.appendChild(img);
    div.appendChild(textarea);
    div.appendChild(del);
    list.appendChild(div);
  });

  Sortable.create(list, {
    animation: 150,
    onEnd: () => {
      docs = [...list.children].map(el => {
        const i = el.querySelector('img').src;
        const t = el.querySelector('textarea').value;
        return { img: i, text: t };
      });
      saveRender();
    }
  });
}

// Processamento da imagem com OpenCV e OCR
async function autoCropOCR(dataUrl) {
  return new Promise((res, rej) => {
    const imgEl = new Image();
    imgEl.src = dataUrl;

    imgEl.onload = async () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = imgEl.width;
      tempCanvas.height = imgEl.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(imgEl, 0, 0);

      let croppedDataUrl = dataUrl;

      try {
        await new Promise(resolve => {
          if (cv && cv.imread) resolve();
          else {
            const check = setInterval(() => {
              if (cv && cv.imread) {
                clearInterval(check);
                resolve();
              }
            }, 100);
          }
        });

        // OpenCV processamento de corte
        const src = cv.imread(tempCanvas);
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        const blur = new cv.Mat();
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
        const edged = new cv.Mat();
        cv.Canny(blur, edged, 75, 200);

        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(edged, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

        let biggest = null;
        let maxArea = 0;
        for (let i = 0; i < contours.size(); i++) {
          const cnt = contours.get(i);
          const area = cv.contourArea(cnt);
          if (area > 1000) {
            const peri = cv.arcLength(cnt, true);
            const approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
            if (approx.rows === 4 && area > maxArea) {
              biggest = approx;
              maxArea = area;
            }
          }
        }

        if (biggest) {
          const pts = [];
          for (let i = 0; i < 4; i++) {
            pts.push({ x: biggest.intAt(i, 0), y: biggest.intAt(i, 1) });
          }

          pts.sort((a, b) => a.y - b.y);
          const [tl, tr] = pts.slice(0, 2).sort((a, b) => a.x - b.x);
          const [bl, br] = pts.slice(2).sort((a, b) => a.x - b.x);

          const maxWidth = Math.max(
            Math.hypot(tr.x - tl.x, tr.y - tl.y),
            Math.hypot(br.x - bl.x, br.y - bl.y)
          );
          const maxHeight = Math.max(
            Math.hypot(bl.x - tl.x, bl.y - tl.y),
            Math.hypot(br.x - tr.x, br.y - tr.y)
          );

          const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
            tl.x, tl.y,
            tr.x, tr.y,
            br.x, br.y,
            bl.x, bl.y
          ]);
          const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0,
            maxWidth, 0,
            maxWidth, maxHeight,
            0, maxHeight
          ]);

          const M = cv.getPerspectiveTransform(srcTri, dstTri);
          const dst = new cv.Mat();
          const dsize = new cv.Size(maxWidth, maxHeight);
          cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

          cv.imshow(tempCanvas, dst);
          croppedDataUrl = tempCanvas.toDataURL('image/jpeg', 0.9);

          src.delete(); gray.delete(); blur.delete(); edged.delete();
          contours.delete(); hierarchy.delete(); biggest.delete();
          dst.delete(); srcTri.delete(); dstTri.delete(); M.delete();
        }
      } catch (e) {
        console.warn('⚠️ OpenCV não disponível. Usando imagem original.', e);
      }

      // OCR com Tesseract.js v4
      progBar.hidden = false;
      prog.style.width = '0%';

      try {
        const { data: { text } } = await Tesseract.recognize(tempCanvas, 'por+eng', {
          logger: m => {
            if (m.status === 'recognizing text') {
              prog.style.width = `${Math.floor(m.progress * 100)}%`;
            }
          }
        });

        progBar.hidden = true;
        res({ img: croppedDataUrl, text });
      } catch (e) {
        progBar.hidden = true;
        console.error('Erro no OCR:', e);
        rej(e);
      }
    };
  });
}

// Captura de imagem
captureBtn.onclick = async () => {
  console.log('📸 Botão capturado clicado');

  const w = cam.videoWidth;
  const h = cam.videoHeight;

  if (!w || !h) {
    alert('Erro: vídeo não disponível.');
    return;
  }

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(cam, 0, 0, w, h);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  captureBtn.disabled = true;
  captureBtn.textContent = 'Processando...';

  try {
    const { img, text } = await autoCropOCR(dataUrl);
    console.log('✅ OCR e corte concluídos');
    docs.push({ img, text });
    saveRender();
  } catch (e) {
    alert('Erro ao processar imagem: ' + e.message);
  } finally {
    captureBtn.disabled = false;
    captureBtn.textContent = '📸 Capturar';
  }
};

// Geração de PDF
genBtn.onclick = () => {
  if (!docs.length) {
    alert('Nenhum documento capturado.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();

  docs.forEach((doc, i) => {
    if (i > 0) pdf.addPage();
    pdf.addImage(doc.img, 'JPEG', 10, 10, 190, 277);
  });

  pdf.save(`documentos_${Date.now()}.pdf`);
};

// Inicialização
renderList();

navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
  .then(stream => {
    cam.srcObject = stream;
    cam.play();
  })
  .catch(e => {
    console.error('Erro ao acessar câmera:', e);
    alert('Erro ao acessar câmera. Verifique permissões.');
  });
