/* =========================================================
   Clasificador de Basura — Versión con Tachos Reales
   Cambios clave:
   - Tachos SVG pegados abajo dentro de la zona (sticky bottom).
   - "Boca" como hitbox real (tercio superior del tacho).
   - Caída ~50% más lenta que la anterior y spawns ajustados.
   - Clamps estrictos: los objetos nunca salen del área.
   ========================================================= */

   (() => {
    // ----- DOM -----
    const $pantInicio   = document.getElementById('pantalla-inicio');
    const $pantJuego    = document.getElementById('pantalla-juego');
    const $pantRes      = document.getElementById('pantalla-resultado');
    const $btnJugar     = document.getElementById('btn-jugar');
    const $btnReint     = document.getElementById('btn-reintentar');
    const $btnInicio    = document.getElementById('btn-inicio');
    const $zona         = document.getElementById('zona-juego');
    const $hudTiempo    = document.getElementById('hud-tiempo');
    const $hudPuntos    = document.getElementById('hud-puntos');
    const $hudCombo     = document.getElementById('hud-combo');
    const $hudRecord    = document.getElementById('hud-record');
    const $toast        = document.getElementById('toast');
    const $resPuntos    = document.getElementById('res-puntos');
    const $resAciertos  = document.getElementById('res-aciertos');
    const $resErrores   = document.getElementById('res-errores');
    const $resRecord    = document.getElementById('res-record');
  
    // ----- Datos -----
    const MATERIALES = [
      { id:'papel',    tecla:'1', emoji:'📄', color:'#3b82f6',
        datos:['El papel se puede reciclar hasta 7 veces.',
               'Reciclar 1 tonelada de papel ahorra ~17 árboles.',
               'Usá papel por ambos lados para reducir consumo.'] },
      { id:'plástico', tecla:'2', emoji:'🧴', color:'#f59e0b',
        datos:['Una botella plástica puede tardar 500 años en degradarse.',
               'Evitá plásticos de un solo uso cuando sea posible.',
               'Reutilizar botellas reduce tu huella ecológica.'] },
      { id:'vidrio',   tecla:'3', emoji:'🍾', color:'#10b981',
        datos:['El vidrio es 100% reciclable infinitas veces.',
               'Separá el vidrio para evitar accidentes y mejorar el reciclaje.',
               'Reciclar vidrio ahorra energía en su fabricación.'] },
      { id:'orgánico', tecla:'4', emoji:'🍎', color:'#84cc16',
        datos:['Los restos orgánicos pueden convertirse en compost.',
               'No mezcles orgánicos con reciclables: contamina el material.',
               'El compost mejora el suelo y retiene humedad.'] },
      { id:'metal',    tecla:'5', emoji:'🥫', color:'#f43f5e',
        datos:['El aluminio se recicla infinitas veces sin perder calidad.',
               'Aplastar latas reduce volumen en el contenedor.',
               'Reciclar metal ahorra mucha energía.'] }
    ];
    const MATERIAL_BY_KEY = Object.fromEntries(MATERIALES.map(m => [m.tecla, m.id]));
    const INDEX_BY_ID     = Object.fromEntries(MATERIALES.map((m, i) => [m.id, i]));
  
    // ----- Estado -----
    const state = {
      jugando: false,
      tiempoRestante: 60_000,
      puntos: 0, aciertos: 0, errores: 0, combo: 1,
      mejor: Number(localStorage.getItem('record_clasificador') || 0),
      objetos: [],
      ultimoSpawn: 0,
      // ⚠ Caída ~50% más lenta que versión anterior:
      velocidadBase: 60,   // antes ~100; ahora 60 px/s (sube con progreso)
      spawnCada: 1600,     // antes ~1200; ahora 1600ms (baja hasta ~800ms)
      t0: 0, rafId: 0
    };
    $hudRecord.textContent = state.mejor;
  
    // ----- Utils -----
    const rnd = (min, max) => Math.random() * (max - min) + min;
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  
    function mostrarPantalla(p) {
      [$pantInicio, $pantJuego, $pantRes].forEach(s => s.classList.remove('visible'));
      p.classList.add('visible');
    }
    function toast(msg, ok=true){
      $toast.textContent = msg;
      $toast.style.background = ok ? '#0b5' : '#b50';
      $toast.classList.add('visible');
      setTimeout(() => $toast.classList.remove('visible'), 1800);
    }
  
    // ----- Tachos / bocas -----
    const $tachos = () => [...document.querySelectorAll('.tacho')];
    const $bocas  = () => [...document.querySelectorAll('.tacho .boca')];
  
    // Retorna el tacho cuya boca contiene el punto (clientX, clientY)
    function tachoEnBoca(clientX, clientY){
      for (const boca of $bocas()){
        const r = boca.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return boca.closest('.tacho');
        }
      }
      return null;
    }
  
    // Centro de la boca (para animación de acierto)
    function centroBoca($tacho){
      const boca = $tacho.querySelector('.boca');
      const rb = boca.getBoundingClientRect();
      return { cx: rb.left + rb.width/2, cy: rb.top + rb.height/2 };
    }
  
    // Convertir coordenadas de ventana a coords relativas de la zona
    function toZonaCoords(clientX, clientY){
      const rz = $zona.getBoundingClientRect();
      return { x: clientX - rz.left, y: clientY - rz.top };
    }
  
    // ----- Objetos -----
    function crearObjeto(){
      const m = pick(MATERIALES);
      const $el = document.createElement('div');
      $el.className = 'obj';
      $el.setAttribute('role', 'button');
      $el.setAttribute('aria-label', `Objeto de ${m.id}. Arrastrá hasta la boca del tacho.`);
      $el.style.borderColor = m.color;
      $el.textContent = m.emoji;
  
      // Medidas actuales del objeto
      const w = Math.max(36, Math.min(54, $el.clientWidth || 48));
      const h = Math.max(36, Math.min(54, $el.clientHeight || 48));
  
      // Clamp de spawn: que no aparezca cortado
      const maxX = $zona.clientWidth - w;
      const spawnX = clamp(rnd(0, maxX), 0, maxX);
      const spawnY = -h; // empieza por fuera de la parte superior
  
      const obj = {
        id: Math.random().toString(36).slice(2),
        material: m.id,
        x: spawnX,
        y: spawnY,
        vy: state.velocidadBase, // px/s
        ancho: w, alto: h,
        dragging: false,
        $el
      };
  
      // Posición inicial en DOM
      actualizarPosicion($el, obj.x, obj.y);
      $zona.appendChild($el);
      state.objetos.push(obj);
  
      // --- Pointer Events (mouse + táctil) con clamps estrictos ---
      let offsetX = 0, offsetY = 0;
      $el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        obj.dragging = true;
        $el.setPointerCapture(e.pointerId);
        const rz = $zona.getBoundingClientRect();
        offsetX = e.clientX - (rz.left + obj.x);
        offsetY = e.clientY - (rz.top  + obj.y);
        $el.style.boxShadow = '0 8px 18px rgba(34,211,238,.45)';
      });
      $el.addEventListener('pointermove', (e) => {
        if (!obj.dragging) return;
        e.preventDefault();
        const rz = $zona.getBoundingClientRect();
        let nx = e.clientX - rz.left - offsetX;
        let ny = e.clientY - rz.top  - offsetY;
        // Clamps dentro de la zona (no se sale jamás)
        nx = clamp(nx, 0, $zona.clientWidth  - obj.ancho);
        ny = clamp(ny, -20, $zona.clientHeight - obj.alto);
        obj.x = nx; obj.y = ny;
        actualizarPosicion($el, obj.x, obj.y);
      }, { passive:false });
      $el.addEventListener('pointerup', (e) => {
        if (!obj.dragging) return;
        obj.dragging = false;
        $el.style.boxShadow = '';
        const $t = tachoEnBoca(e.clientX, e.clientY);
        if ($t) intentarClasificar(obj, $t.dataset.bin, true);
      });
  
      return obj;
    }
  
    function eliminarObjeto(obj){
      obj.$el.remove();
      state.objetos = state.objetos.filter(o => o !== obj);
    }
  
    function actualizarPosicion($el, x, y){
      $el.style.transform = `translate(${x}px, ${y}px)`;
    }
  
    // ----- Lógica de clasificación -----
    function intentarClasificar(obj, binId){
      if (!state.jugando) return;
      const correcto = obj.material === binId;
      if (correcto){
        state.puntos += 1 * state.combo;
        state.aciertos++;
        state.combo = Math.min(state.combo + 1, 9);
        $hudCombo.textContent = `x${state.combo}`;
        toast(mensajeEducativo(binId), true);
        animarHaciaBoca(obj, binId, () => eliminarObjeto(obj));
      } else {
        state.puntos -= 1;
        state.errores++;
        state.combo = 1;
        $hudCombo.textContent = `x${state.combo}`;
        toast('Ups, tacho incorrecto 😬', false);
        // sacudida breve
        obj.$el.animate(
          [
            {transform:`translate(${obj.x}px, ${obj.y}px)`},
            {transform:`translate(${obj.x-6}px, ${obj.y}px)`},
            {transform:`translate(${obj.x+6}px, ${obj.y}px)`},
            {transform:`translate(${obj.x}px, ${obj.y}px)`}
          ], {duration:180}
        );
      }
      $hudPuntos.textContent = state.puntos;
    }
  
    function mensajeEducativo(materialId){
      const m = MATERIALES[INDEX_BY_ID[materialId]];
      return pick(m.datos);
    }
  
    // Animación apuntando al centro de la boca del tacho (hitbox real)
    function animarHaciaBoca(obj, binId, onFinish){
      const $t = document.querySelector(`.tacho[data-bin="${binId}"]`);
      const { cx, cy } = centroBoca($t);
      const rz = $zona.getBoundingClientRect();
      const tx = cx - rz.left - (obj.ancho/2);
      const ty = cy - rz.top  - (obj.alto/2);
      obj.$el.animate(
        [
          { transform: `translate(${obj.x}px, ${obj.y}px) scale(1)` },
          { transform: `translate(${tx}px, ${ty}px) scale(0.6)` }
        ],
        { duration: 240, easing:'ease-out' }
      ).onfinish = onFinish;
    }
  
    // Teclado: envía el objeto más bajo a la boca correspondiente
    function clasificarPorTecla(n){
      const binId = MATERIAL_BY_KEY[n];
      if (!binId) return;
      const obj = state.objetos.slice().sort((a,b)=> b.y - a.y)[0];
      if (!obj) return;
      intentarClasificar(obj, binId);
    }
  
    // ----- Bucle principal -----
    function loop(t){
      if (!state.jugando) return;
      if (!state.t0) state.t0 = t;
      const dt = Math.min(34, t - state.t0); // ms
      state.t0 = t;
  
      // Tiempo
      state.tiempoRestante -= dt;
      $hudTiempo.textContent = Math.max(0, Math.ceil(state.tiempoRestante/1000));
      if (state.tiempoRestante <= 0){ terminarPartida(); return; }
  
      // Dificultad: más velocidad y menor tiempo entre spawns
      const progreso = 1 - (state.tiempoRestante / 60000); // 0..1
      state.velocidadBase = 60 + progreso * 120;           // 60 -> 180 px/s
      state.spawnCada     = 1600 - progreso * 800;         // 1600ms -> 800ms
  
      // Spawns temporizados sin setInterval
      state.ultimoSpawn += dt;
      if (state.ultimoSpawn >= state.spawnCada){
        state.ultimoSpawn = 0;
        crearObjeto();
      }
  
      // Caída con clamps
      for (const obj of state.objetos.slice()){
        if (!obj.dragging){
          obj.y += (state.velocidadBase * (dt/1000));
          // Piso: no salir del área
          const yMax = $zona.clientHeight - obj.alto;
          if (obj.y > yMax){
            // Tocó el piso => error
            obj.y = yMax;
            state.puntos -= 1;
            state.errores++;
            state.combo = 1;
            $hudPuntos.textContent = state.puntos;
            $hudCombo.textContent = 'x1';
            toast('Se cayó al piso: −1 😢', false);
            eliminarObjeto(obj);
            continue;
          }
          // Clamp lateral
          obj.x = clamp(obj.x, 0, $zona.clientWidth - obj.ancho);
          actualizarPosicion(obj.$el, obj.x, obj.y);
        }
      }
  
      state.rafId = requestAnimationFrame(loop);
    }
  
    // ----- Control de partida -----
    function iniciarPartida(){
      state.jugando = true;
      state.tiempoRestante = 60_000;
      state.puntos = 0; state.aciertos = 0; state.errores = 0; state.combo = 1;
      state.objetos.forEach(o => o.$el.remove()); state.objetos = [];
      state.ultimoSpawn = 0; state.velocidadBase = 60; state.spawnCada = 1600;
      state.t0 = 0;
  
      $hudPuntos.textContent = '0';
      $hudCombo.textContent = 'x1';
      $hudTiempo.textContent = '60';
  
      mostrarPantalla($pantJuego);
      crearObjeto(); // primer objeto inmediato
      cancelAnimationFrame(state.rafId);
      state.rafId = requestAnimationFrame(loop);
    }
  
    function terminarPartida(){
      state.jugando = false;
      cancelAnimationFrame(state.rafId);
      state.objetos.forEach(o => o.$el.remove());
      state.objetos = [];
  
      if (state.puntos > state.mejor){
        state.mejor = state.puntos;
        localStorage.setItem('record_clasificador', String(state.mejor));
        $hudRecord.textContent = state.mejor;
      }
  
      $resPuntos.textContent   = state.puntos;
      $resAciertos.textContent = state.aciertos;
      $resErrores.textContent  = state.errores;
      $resRecord.textContent   = state.mejor;
  
      mostrarPantalla($pantRes);
    }
  
    // ----- Eventos -----
    document.getElementById('btn-jugar')?.addEventListener('click', iniciarPartida);
    document.getElementById('btn-reintentar')?.addEventListener('click', iniciarPartida);
    document.getElementById('btn-inicio')?.addEventListener('click', () => mostrarPantalla($pantInicio));
  
    // Teclado 1..5
    window.addEventListener('keydown', (e) => {
      if (!state.jugando) return;
      if (['1','2','3','4','5'].includes(e.key)){
        e.preventDefault();
        clasificarPorTecla(e.key);
      }
    });
  
    // Click sobre tachos: envía el objeto más bajo al tacho clickeado (boca asumida)
    document.querySelectorAll('.tacho').forEach($t => {
      $t.addEventListener('click', () => {
        if (!state.jugando) return;
        const obj = state.objetos.slice().sort((a,b)=> b.y - a.y)[0];
        if (obj) intentarClasificar(obj, $t.dataset.bin);
      });
    });
  
    // Prevenir scroll accidental durante gestos dentro de la zona en móvil
    ['touchmove','gesturestart'].forEach(evt => {
      document.addEventListener(evt, (e) => {
        if ($pantJuego.classList.contains('visible')) e.preventDefault();
      }, { passive:false });
    });
  
    // Tip inicial
    toast('Tip: soltá en la BOCA del tacho (tercio superior).', true);
  })();
  