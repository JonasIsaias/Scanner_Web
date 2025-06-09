(() => {
    // Elementos
    const cam = document.getElementById('camera');
    const overlay = document.getElementById('overlay');
    const ctxOver = overlay.getContext('2d');
    const captureBtn = document.getElementById('captureBtn');
    const genBtn = document.getElementById('generatePdfBtn');
    const shareWA = document.getElementById('shareWhatsApp');
    const list = document.getElementById('docsList');
    const toggleTheme = document.getElementById('toggleTheme');
    const progBar = document.getElementById('progressBar');
    const prog = document.getElementById('progress');
    const cropContainer = document.getElementById('cropContainer');
  
    let docs = [], cropper = null;
  
    // Alterna tema claro/escuro
    toggleTheme.onclick = () => {
      const root = document.documentElement;
      root.setAttribute('data-theme', root.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    };
  
    // Espera OpenCV estar pronto
    function waitForCVReady() {
      return new Promise(resolve => {
        const check = () => {
          if (cv && cv.imread) resolve();
          else setTimeout(check, 50);
        };
        check();
      });
    }
  
    // Inicializa câmera
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }})
      .then(stream => {
        cam.srcObject = stream;
        cam.onloadedmetadata = async () => {
          overlay.width = cam.videoWidth;
          overlay.height = cam.videoHeight;
          await waitForCVReady();
          drawRealtimeEdges(); 
        };
        cam.play();
      })
      .catch(() => alert('Não foi possível acessar a câmera.'));
  
    // Desenha contornos em tempo real
    function drawRealtimeEdges() {
      const srcMat = new cv.Mat(cam.videoHeight, cam.videoWidth, cv.CV_8UC4);
      const gray = new cv.Mat(), edges = new cv.Mat();
      const cap = new cv.VideoCapture(cam);
      const FPS = 15;
  
      function processFrame() {
        cap.read(srcMat);
        cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
        cv.Canny(gray, edges, 75, 200);
        const imgData = new ImageData(new Uint8ClampedArray(edges.data), edges.cols, edges.rows);
        ctxOver.putImageData(imgData, 0, 0);
        setTimeout(() => requestAnimationFrame(processFrame), 1000 / FPS);
      }
  
      processFrame();
    }
  
    // Renderiza lista de documentos
    function saveRender() {
      list.innerHTML = '';
      docs.forEach((d, i) => {
        const div = document.createElement('div');
        div.className = 'doc';
  
        const img = document.createElement('img');
        img.src = d.img;
        img.alt = 'Documento digitalizado';
        img.onclick = () => window.open(d.img, '_blank');
  
        const ta = document.createElement('textarea');
        ta.value = d.text || '';
        ta.onchange = () => { d.text = ta.value; saveRender(); };
  
        const del = document.createElement('button');
        del.textContent = '🗑️ Excluir';
        del.onclick = () => { docs.splice(i, 1); saveRender(); };
  
        div.append(img, ta, del);
        list.appendChild(div);
      });
    }
  
    // Função para corte automático + edição
    function autoCropEdit(dataUrl) {
      return new Promise(resolve => {
        const img = new Image();
        img.src = dataUrl;
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const ct = c.getContext('2d');
          ct.drawImage(img, 0, 0);
  
          const src = cv.imread(c), gray = new cv.Mat(), blur = new cv.Mat(), edge = new cv.Mat();
          cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
          cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
          cv.Canny(blur, edge, 75, 200);
          const ctrs = new cv.MatVector(), hier = new cv.Mat();
          cv.findContours(edge, ctrs, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  
          let best = null, areaMax = 0;
          for (let i = 0; i < ctrs.size(); i++) {
            const ct = ctrs.get(i);
            const peri = cv.arcLength(ct, true);
            const ap = new cv.Mat();
            cv.approxPolyDP(ct, ap, 0.02 * peri, true);
            const area = cv.contourArea(ct);
            if (ap.rows === 4 && area > areaMax) {
              best = ap;
              areaMax = area;
            }
          }
  
          let cropBase = c.toDataURL();
          if (best) {
            const pts = [];
            for (let i = 0; i < 4; i++) pts.push({ x: best.intAt(i, 0), y: best.intAt(i, 1) });
            pts.sort((a, b) => a.y - b.y);
            const [tl, tr] = pts.slice(0, 2).sort((a, b) => a.x - b.x);
            const [bl, br] = pts.slice(2).sort((a, b) => a.x - b.x);
  
            const width = Math.max(
              Math.hypot(tr.x - tl.x, tr.y - tl.y),
              Math.hypot(br.x - bl.x, br.y - bl.y)
            );
            const height = Math.max(
              Math.hypot(bl.x - tl.x, bl.y - tl.y),
              Math.hypot(br.x - tr.x, br.y - tr.y)
            );
  
            const srcTri = cv.matFromArray(4,1,cv.CV_32FC2, [tl.x,tl.y,tr.x,tr.y,br.x,br.y,bl.x,bl.y]);
            const dstTri = cv.matFromArray(4,1,cv.CV_32FC2, [0,0,width,0,width,height,0,height]);
            const M = cv.getPerspectiveTransform(srcTri, dstTri);
            const dst = new cv.Mat();
            cv.warpPerspective(src, dst, M, new cv.Size(width, height));
  
            const kernel = cv.Mat.eye(3, 3, cv.CV_32F);
            kernel.data32F.set([0,-1,0,-1,5,-1,0,-1,0]);
            const sharp = new cv.Mat();
            cv.filter2D(dst, sharp, cv.CV_8U, kernel);
  
            const out = document.createElement('canvas');
            out.width = width;
            out.height = height;
            cv.imshow(out, sharp);
            cropBase = out.toDataURL('image/jpeg', 0.9);
  
            [src, gray, blur, edge, ctrs, hier, dst, sharp, srcTri, dstTri, M].forEach(o => o.delete());
          }
  
          cropContainer.innerHTML = '';
          const imgc = new Image();
          imgc.src = cropBase;
          cropContainer.appendChild(imgc);
  
          cropper?.destroy();
          cropper = new Cropper(imgc, {
            viewMode: 1,
            autoCropArea: 1,
            movable: true,
            zoomable: true,
            cropBoxResizable: true,
            ready() {
              const btn = document.createElement('button');
              btn.textContent = '✔️ Confirmar corte';
              cropContainer.appendChild(btn);
              btn.onclick = () => {
                const final = cropper.getCroppedCanvas().toDataURL('image/jpeg', 0.9);
                cropper.destroy();
                cropContainer.innerHTML = '';
                resolve(final);
              };
            }
          });
        };
      });
    }
  
    // OCR com barra de progresso
    async function runOCR(canvas) {
      progBar.hidden = false;
      prog.style.width = '0%';
      const { data: { text } } = await Tesseract.recognize(canvas, 'por+eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            prog.style.width = `${Math.floor(m.progress * 100)}%`;
          }
        }
      });
      progBar.hidden = true;
      return text;
    }
  
    // Captura imagem
    captureBtn.onclick = async () => {
      if (!cam.videoWidth) return alert('Câmera não está pronta');
      overlay.getContext('2d').drawImage(cam, 0, 0);
      const dataUrl = overlay.toDataURL('image/jpeg', 0.9);
      captureBtn.disabled = true;
      try {
        const crop = await autoCropEdit(dataUrl);
        const img = new Image();
        img.src = crop;
        img.onload = async () => {
          const tc = document.createElement('canvas');
          tc.width = img.width;
          tc.height = img.height;
          tc.getContext('2d').drawImage(img, 0, 0);
          const text = await runOCR(tc);
          docs.push({ img: crop, text });
          saveRender();
        };
      } catch (err) {
        alert('Erro ao capturar: ' + err.message);
      } finally {
        captureBtn.disabled = false;
      }
    };
  
    // Exportar documentos
    genBtn.onclick = async () => {
      if (!docs.length) return alert('Nenhum documento.');
      const { jsPDF } = window.jspdf;
      if (confirm('Salvar como PDF? Cancelar para JPG.')) {
        const pdf = new jsPDF();
        docs.forEach((d, i) => {
          if (i > 0) pdf.addPage();
          pdf.addImage(d.img, 'JPEG', 10, 10, 190, 277);
        });
        const blob = pdf.output('blob');
        const file = new File([blob], `scan_${Date.now()}.pdf`, { type: 'application/pdf' });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] });
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = file.name;
          a.click();
        }
      } else {
        docs.forEach((d, i) => {
          const a = document.createElement('a');
          a.href = d.img;
          a.download = `scan_${i + 1}_${Date.now()}.jpg`;
          a.click();
        });
      }
    };
  
    // Compartilhar via WhatsApp
    shareWA.onclick = () => {
      if (!docs.length) return alert('Nenhum documento.');
      const text = encodeURIComponent('Confira meu documento digitalizado.');
      window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
    };
  
    // Salvar no localStorage
    window.addEventListener('beforeunload', () => localStorage.setItem('docs', JSON.stringify(docs)));
    window.addEventListener('load', () => {
      const stored = localStorage.getItem('docs');
      if (stored) {
        docs = JSON.parse(stored);
        saveRender();
      }
    });
  })();  
