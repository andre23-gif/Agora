/* =====================================================
   bandeau.js — Nuage de particules dorées
   Injection automatique d'un <canvas> dans .ag-header
   Particules :
     - naissent à gauche (zone marque)
     - dérivent vers la droite en s'effaçant
     - tailles et vitesses variées → effet nuage
   Aucune dépendance, aucun import.
   ===================================================== */

(function () {

  /* --- Configuration --- */
  const CFG = {
    count:      420,    // nombre de particules simultanées
    minR:       0.2,    // rayon min px
    maxR:       2.0,    // rayon max px
    minSpeed:   0.08,   // vitesse horizontale min px/frame
    maxSpeed:   0.35,   // vitesse horizontale max px/frame
    drift:      0.40,   // amplitude dérive verticale (px/frame max)
    spawnZone:  0.18,   // les particules naissent dans les 30% gauche
    fadeStart:  0.15,   // commence à s'effacer à 28% de la largeur
    fadeEnd:    0.55,   // totalement transparent à 72%
    colors: [
      [255, 215,  80],  // or vif
      [245, 192,  96],  // or doux
      [255, 240, 140],  // or clair
      [232, 160,  48],  // ambre
      [255, 200,  60],  // jaune-or
    ],
  };

  /* --- Attendre que le header existe --- */
  function init() {
    const header = document.querySelector('.ag-header');
    if (!header) { requestAnimationFrame(init); return; }

    /* Canvas */
    const canvas = document.createElement('canvas');
    canvas.id = 'bandeauCanvas';
    header.insertBefore(canvas, header.firstChild);

    const ctx = canvas.getContext('2d');

    /* Redimensionnement */
    function resize() {
      const r = header.getBoundingClientRect();
      canvas.width  = r.width;
      canvas.height = r.height;
    }
    resize();
    new ResizeObserver(resize).observe(header);

    /* Création d'une particule */
    function spawn() {
      const col = CFG.colors[Math.floor(Math.random() * CFG.colors.length)];
      return {
        x:     Math.random() * canvas.width  * CFG.spawnZone,
        y:     Math.random() * canvas.height,
        r:     CFG.minR + Math.random() * (CFG.maxR - CFG.minR),
        vx:    CFG.minSpeed + Math.random() * (CFG.maxSpeed - CFG.minSpeed),
        vy:    (Math.random() - 0.5) * CFG.drift * 2,
        col:   col,
        life:  0,       // 0..1 — progression horizontale normalisée
      };
    }

    /* Pool initial */
    const particles = [];
    for (let i = 0; i < CFG.count; i++) {
      const p = spawn();
      // Étaler les positions initiales sur toute la zone de spawn
      p.x = Math.random() * canvas.width * CFG.spawnZone;
      particles.push(p);
    }

    /* Boucle d'animation */
    function frame() {
      const W = canvas.width;
      const H = canvas.height;

      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        /* Déplacement */
        p.x += p.vx;
        p.y += p.vy;
        /* Rebond vertical doux */
        if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy); }
        if (p.y > H) { p.y = H; p.vy = -Math.abs(p.vy); }

        /* Opacité selon position X */
        const t = p.x / W;
        let alpha;
        if (t < CFG.fadeStart) {
          alpha = 0.85;
        } else if (t > CFG.fadeEnd) {
          alpha = 0;
        } else {
          alpha = 0.85 * (1 - (t - CFG.fadeStart) / (CFG.fadeEnd - CFG.fadeStart));
        }

        /* Recyclage quand invisible ou hors canvas */
        if (alpha <= 0 || p.x > W) {
          particles[i] = spawn();
          continue;
        }

        /* Dessin */
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.col[0]},${p.col[1]},${p.col[2]},${alpha.toFixed(3)})`;
        ctx.fill();
      }

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  /* Lancement après chargement du DOM */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
