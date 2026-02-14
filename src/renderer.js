/**
 * Pixel Art Rendering Pipeline
 *
 * Architecture:
 *   1. All scene drawing happens on a small off-screen canvas (the "buffer")
 *      at a fixed virtual resolution (e.g. 320×180).
 *   2. Each frame, the buffer is scaled up to the full display canvas using
 *      nearest-neighbor interpolation (imageSmoothingEnabled = false).
 *   3. This gives us the chunky, deliberate pixel art aesthetic — every
 *      "pixel" on the buffer becomes a crisp block on screen.
 *
 * The buffer dimensions define the art resolution. Smaller = chunkier pixels.
 * 320×180 gives a 16:9 ratio at a retro-feeling resolution.
 */

/** Virtual resolution — the "art" resolution we draw at */
const BUFFER_WIDTH = 320;
const BUFFER_HEIGHT = 180;

/**
 * Create the rendering pipeline.
 *
 * @param {HTMLCanvasElement} displayCanvas — the visible, full-screen canvas
 * @returns {Renderer}
 */
export function createRenderer(displayCanvas) {
  const displayCtx = displayCanvas.getContext('2d');

  // Off-screen buffer where all scene drawing happens
  const buffer = document.createElement('canvas');
  buffer.width = BUFFER_WIDTH;
  buffer.height = BUFFER_HEIGHT;
  const bufferCtx = buffer.getContext('2d');

  // Disable smoothing on the display context — nearest-neighbor scaling
  function disableSmoothing() {
    displayCtx.imageSmoothingEnabled = false;
  }

  // Set display canvas to fill the viewport
  function resize() {
    displayCanvas.width = window.innerWidth;
    displayCanvas.height = window.innerHeight;
    // Re-apply after resize (canvas reset clears this)
    disableSmoothing();
  }

  // Initial sizing
  resize();

  /**
   * Flush the off-screen buffer to the display canvas.
   * Scales the buffer to fill the display while maintaining aspect ratio,
   * centering with letterbox/pillarbox bars if needed.
   */
  function flush() {
    const dw = displayCanvas.width;
    const dh = displayCanvas.height;

    // Calculate scale to fill display while maintaining buffer aspect ratio
    const scaleX = dw / BUFFER_WIDTH;
    const scaleY = dh / BUFFER_HEIGHT;
    const scale = Math.max(scaleX, scaleY);

    const scaledW = Math.ceil(BUFFER_WIDTH * scale);
    const scaledH = Math.ceil(BUFFER_HEIGHT * scale);

    // Center the scaled buffer on the display
    const offsetX = Math.floor((dw - scaledW) / 2);
    const offsetY = Math.floor((dh - scaledH) / 2);

    // Clear display and draw scaled buffer
    displayCtx.fillStyle = '#0a0a1a';
    displayCtx.fillRect(0, 0, dw, dh);
    displayCtx.drawImage(buffer, offsetX, offsetY, scaledW, scaledH);
  }

  /**
   * Clear the off-screen buffer.
   * @param {string} [color='#0a0a1a'] — fill color
   */
  function clear(color = '#0a0a1a') {
    bufferCtx.fillStyle = color;
    bufferCtx.fillRect(0, 0, BUFFER_WIDTH, BUFFER_HEIGHT);
  }

  /**
   * Get direct pixel access to the buffer for per-pixel manipulation.
   * @returns {ImageData}
   */
  function getImageData() {
    return bufferCtx.getImageData(0, 0, BUFFER_WIDTH, BUFFER_HEIGHT);
  }

  /**
   * Write pixel data back to the buffer.
   * @param {ImageData} imageData
   */
  function putImageData(imageData) {
    bufferCtx.putImageData(imageData, 0, 0);
  }

  return {
    /** The off-screen buffer's 2D context — draw your scene here */
    ctx: bufferCtx,
    /** The off-screen buffer canvas element */
    buffer,
    /** Virtual resolution width */
    width: BUFFER_WIDTH,
    /** Virtual resolution height */
    height: BUFFER_HEIGHT,
    /** Display canvas reference */
    displayCanvas,
    /** Display context reference */
    displayCtx,
    /** Scale buffer to display canvas */
    flush,
    /** Clear the buffer */
    clear,
    /** Get raw pixel data from buffer */
    getImageData,
    /** Write raw pixel data to buffer */
    putImageData,
    /** Recalculate display sizing */
    resize,
  };
}
