const cam = document.getElementById('camera');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const docList = document.getElementById('docsList');
const progBar = document.getElementById('progressBar');
const prog = document.getElementById('progress');
const captureBtn = document.getElementById('captureBtn');
const genBtn = document.getElementById('generatePdfBtn');
const toggleTheme = document.getElementById('toggleTheme');

let docs = JSON.parse(localStorage.getItem('docs') || '[]');

// Tema (modo claro/escuro) com persistência
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  toggleTheme.textContent = theme === 'dark' ? '☀️' : '🌙';
}

toggleTheme.onclick = () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
};

applyTheme(
  localStorage.getItem('theme') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
);

// Salva no localStorage e re-renderiza lista
function saveRender() {
  localStorage.setItem('docs', JSON.stringify(docs));
  renderList();
}

// Renderiza lista de documentos com edição e exclusão
function renderList() {
  docList.innerHTML = '';
  docs.forEach((doc, i) => {
    const li = document.createElement('li');
    li.className = 'doc';
    li.setAttribute('data-id', i);

    // Miniatura da imagem
    const img = document.createElement('img');
    img.src = doc.img;
    img.alt = `Documento ${i + 1}`;

    // Textarea para edição do texto OCR
    const ta = document.createElement('textarea');
    ta.value = doc.text;
    ta.setAttribute('aria-label', `Texto do documento ${i + 1}`);
    ta.onchange = () => {
      docs[i].text = ta.value;
      saveRender();
    };

    // Botão excluir
    const del = document.createElement('button');
    del.textContent = 'Excluir';
    del.setAttribute('aria-label', `Excluir documento ${i + 1}`);
    del.onclick = () => {
      docs.splice(i, 1);
      saveRender();
    };

    li.append(img, ta, del);
    docList.appendChild(li);
  });
}

// Inicializa drag and drop com Sortable.js
document.addEventListener('DOMContentLoaded', () => {
  new Sortable(docList, {
    animation: 150,
    onEnd: evt => {
      const [moved] = docs.splice(evt.oldIndex, 1);
      docs.splice(evt.newIndex, 0, moved);
      saveRender();
    }
  });
});

// Acesso à câmera do dispositivo
navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
  .then(stream => {
    cam.srcObject = stream;
  })
  .catch(err => {
    alert('Erro ao acessar a câmera: ' + err.message);
  });

// Função para tentar corte automático com OpenCV.js e fallback para imagem original
async function autoCropOCR(dataUrl) {
  // Espera OpenCV pronto
  if (!cv || !cv.imread) {
    throw new Error('OpenCV.js não carregado');
  }

  await new Promise(resolve => {
    if (cv['onRuntimeInitialized']) {
      cv['onRuntimeInitialized'] = () => resolve();
    } else {
      resolve();
    }
  });

  return new Promise(res => {
    const img = new Image();
    img.src = dataUrl;
    img.onload = async () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      let croppedDataUrl = dataUrl;

      try {
        // Processamento OpenCV para corte e perspectiva
        const src = cv.imread(canvas);
        const gray = new cv.Mat();
        const edges = new cv.Mat();
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();

        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
        cv.Canny(gray, edges, 75, 200);

        cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let maxContour = null;

        for (let i = 0; i < contours.size(); i++) {
          let cnt = contours.get(i);
          const area = cv.contourArea(cnt, false);
          if (area > maxArea) {
            maxArea = area;
            maxContour = cnt;
          }
        }

        if (!maxContour) throw new Error('Nenhum contorno encontrado');

        const peri = cv.arcLength(maxContour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(maxContour, approx, 0.02 * peri, true);

        if (approx.rows === 4) {
          // Quatro pontos - aplicando perspectiva
          let pts = [];
          for (let i = 0; i < 4; i++) {
            pts.push({ x: approx.intPtr(i, 0)[0], y: approx.intPtr(i, 0)[1] });
          }

          // Ordenar os pontos (top-left, top-right, bottom-right, bottom-left)
          pts.sort((a, b) => a.y - b.y);
          let top = pts.slice(0, 2).sort((a, b) => a.x - b.x);
          let bottom = pts.slice(2, 4).sort((a, b) => a.x - b.x);
          const ordered = [top[0], top[1], bottom[1], bottom[0]];

          const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
            ordered[0].x, ordered[0].y,
            ordered[1].x, ordered[1].y,
            ordered[2].x, ordered[2].y,
            ordered[3].x, ordered[3].y
          ]);
          const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0,
            img.width, 0,
            img.width, img.height,
            0, img.height
          ]);

          const M = cv.getPerspectiveTransform(srcTri, dstTri);
          let warped = new cv.Mat();
          cv.warpPerspective(src, warped, M, new cv.Size(img.width, img.height));

          cv.imshow(canvas, warped);
          croppedDataUrl = canvas.toDataURL('image/jpeg', 0.9);

          // Liberar memória
          src.delete(); gray.delete(); edges.delete();
          contours.delete(); hierarchy.delete(); approx.delete();
          srcTri.delete(); dstTri.delete(); warped.delete();
        } else {
          // Caso não tenha 4 cantos, fallback
          src.delete(); gray.delete(); edges.delete();
          contours.delete(); hierarchy.delete(); approx.delete();
          throw new Error('Não foram detectados 4 cantos para corte.');
        }
      } catch (e) {
        console.warn('Corte automático falhou:', e.message);
        // fallback: já está usando dataUrl original
      }

      // OCR com Tesseract.js e barra de progresso
      progBar.hidden = false;
      prog.style.width = '0%';

      const worker = Tesseract.createWorker({
        logger: m => {
          if (m.status === 'recognizing text') {
            prog.style.width = `${Math.floor(m.progress * 100)}%`;
          }
        }
      });

      await worker.load();
      await worker.loadLanguage('por+eng');
      await worker.initialize('por+eng');

      // Usar canvas atual para reconhecimento
      const { data: { text } } = await worker.recognize(canvas);

      await worker.terminate();

      progBar.hidden = true;

      res({ img: croppedDataUrl, text });
    };
  });
}

// Botão capturar: tira foto, processa e armazena documento
captureBtn.onclick = async () => {
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
    docs.push({ img, text });
    saveRender();
  } catch (e) {
    alert('Erro ao processar imagem: ' + e.message);
  } finally {
    captureBtn.disabled = false;
    captureBtn.textContent = '📸 Capturar';
  }
};

// Botão gerar PDF
genBtn.onclick = () => {
  if (!docs.length) {
    alert('Nenhum documento capturado.');
    return;
  }

  // Usar jsPDF via global window.jspdf.jsPDF
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();

  docs.forEach((doc, i) => {
    if (i > 0) pdf.addPage();
    pdf.addImage(doc.img, 'JPEG', 10, 10, 190, 277);
  });

  pdf.save(`documentos_${Date.now()}.pdf`);
};

// Inicializa a lista com documentos salvos
renderList();