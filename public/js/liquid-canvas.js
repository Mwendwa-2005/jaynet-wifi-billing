/**
 * JayNet Apple-Style Floating Liquid Canvas Animation
 * Generates organic liquid metaballs, fluid gradients, and dynamic mouse interaction
 */

(function () {
  const canvas = document.getElementById('liquid-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let width, height;
  let mouse = { x: null, y: null, radius: 250 };

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  window.addEventListener('resize', resize);
  resize();

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  window.addEventListener('mouseleave', () => {
    mouse.x = null;
    mouse.y = null;
  });

  // Blob definition
  class LiquidBlob {
    constructor() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.radius = Math.random() * 180 + 120;
      this.vx = (Math.random() - 0.5) * 0.8;
      this.vy = (Math.random() - 0.5) * 0.8;
      
      const colors = [
        'rgba(0, 240, 255, 0.25)',   // Electric Cyan
        'rgba(112, 0, 255, 0.25)',   // Deep Purple
        'rgba(0, 113, 227, 0.22)',   // Apple Blue
        'rgba(255, 0, 127, 0.18)'    // Neon Magenta
      ];
      this.color = colors[Math.floor(Math.random() * colors.length)];
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;

      // Bounce off boundaries with smooth turn
      if (this.x < -this.radius) this.x = width + this.radius;
      if (this.x > width + this.radius) this.x = -this.radius;
      if (this.y < -this.radius) this.y = height + this.radius;
      if (this.y > height + this.radius) this.y = -this.radius;

      // Mouse repulsion/fluid interaction
      if (mouse.x !== null && mouse.y !== null) {
        const dx = mouse.x - this.x;
        const dy = mouse.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < mouse.radius + this.radius) {
          const angle = Math.atan2(dy, dx);
          const force = (mouse.radius - dist) / mouse.radius;
          this.x -= Math.cos(angle) * force * 3;
          this.y -= Math.sin(angle) * force * 3;
        }
      }
    }

    draw() {
      const gradient = ctx.createRadialGradient(
        this.x,
        this.y,
        0,
        this.x,
        this.y,
        this.radius
      );
      gradient.addColorStop(0, this.color);
      gradient.addColorStop(1, 'rgba(8, 9, 13, 0)');

      ctx.beginPath();
      ctx.fillStyle = gradient;
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Create liquid blobs
  const blobCount = Math.min(8, Math.floor(window.innerWidth / 160));
  const blobs = [];
  for (let i = 0; i < blobCount; i++) {
    blobs.push(new LiquidBlob());
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    // Deep ambient base fill
    ctx.fillStyle = '#08090d';
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < blobs.length; i++) {
      blobs[i].update();
      blobs[i].draw();
    }
    ctx.globalCompositeOperation = 'source-over';

    requestAnimationFrame(animate);
  }

  animate();
})();
