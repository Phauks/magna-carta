/*
 * The background worker: finds the member in each camera frame and draws them over a blurred room or
 * a chosen picture, entirely off the meeting's main thread.
 *
 * It is the only place the segmentation engine is loaded, so nobody who never turns an effect on
 * downloads it. A frame arrives in one of two ways, and leaves the same way it came:
 *
 *   * as a stream of `VideoFrame`s (where the browser can hand a camera track to a worker), read from
 *     one stream and written to another, so frames never touch the main thread at all;
 *   * as one `ImageBitmap` per message, answered with one `ImageBitmap`, where it cannot.
 *
 * NOTHING HERE LEAVES THE MEMBER'S BROWSER. The frame, the mask and the chosen picture stay in this
 * worker; what goes back is the picture the room will see anyway.
 */
import { ensureReady, loadPersonSegmenter, type PersonSegmenter } from "@magna-carta/segmentation";
import {
  coverFit,
  FRAGMENT_SHADER,
  modeCode,
  steadyMask,
  toModelInput,
  VERTEX_SHADER,
  type BackgroundMode,
} from "./background-compositing.ts";
import type { BackgroundWorkerReply, BackgroundWorkerRequest } from "./background-processor.ts";

// The worker's global is typed as a window by the app's DOM library; the two members used here are
// the ones both scopes share, and a reply is posted without a target origin.
const scope = self as unknown as {
  postMessage(message: BackgroundWorkerReply, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<BackgroundWorkerRequest>) => void) | null;
};

/** Everything one running composite holds. */
interface Compositor {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: OffscreenCanvas;
  readonly sampler: OffscreenCanvasRenderingContext2D;
  readonly segmenter: PersonSegmenter;
  readonly modelInput: Float32Array;
  readonly runningMask: Float32Array;
  readonly maskBytes: Uint8Array;
  readonly cameraTexture: WebGLTexture;
  readonly maskTexture: WebGLTexture;
  readonly imageTexture: WebGLTexture;
  readonly uniforms: {
    readonly mode: WebGLUniformLocation | null;
    readonly imageFit: WebGLUniformLocation | null;
    readonly blurReach: WebGLUniformLocation | null;
  };
  firstMask: boolean;
  mode: BackgroundMode;
}

let compositor: Compositor | null = null;
let stopped = false;

function fail(reason: "engine" | "graphics"): void {
  scope.postMessage({ type: "failed", reason });
}

function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind);
  if (shader === null) throw new Error("graphics");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) throw new Error("graphics");
  return shader;
}

function texture(gl: WebGL2RenderingContext, unit: number, mipmapped: boolean): WebGLTexture {
  const made = gl.createTexture();
  if (made === null) throw new Error("graphics");
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, made);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return made;
}

/** Build the composite for a camera of this size. Throws "engine" or "graphics" as an Error. */
async function buildCompositor(width: number, height: number): Promise<Compositor> {
  let segmenter: PersonSegmenter;
  try {
    await ensureReady();
    segmenter = loadPersonSegmenter();
  } catch {
    throw new Error("engine");
  }

  const canvas = new OffscreenCanvas(width, height);
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
  const sampler = new OffscreenCanvas(segmenter.frame.width, segmenter.frame.height).getContext(
    "2d",
    { willReadFrequently: true },
  );
  if (gl === null || sampler === null) {
    segmenter.release();
    throw new Error("graphics");
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    segmenter.release();
    throw new Error("graphics");
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const cameraTexture = texture(gl, 0, true);
  const maskTexture = texture(gl, 1, false);
  const imageTexture = texture(gl, 2, false);
  gl.uniform1i(gl.getUniformLocation(program, "cameraFrame"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "personMask"), 1);
  gl.uniform1i(gl.getUniformLocation(program, "backgroundImage"), 2);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const pixels = segmenter.frame.width * segmenter.frame.height;
  const uniforms = {
    mode: gl.getUniformLocation(program, "mode"),
    imageFit: gl.getUniformLocation(program, "imageFit"),
    blurReach: gl.getUniformLocation(program, "blurReach"),
  };
  // How far the blur reaches, as a share of the frame: the same look at any camera resolution.
  gl.uniform2f(uniforms.blurReach, 0.012, 0.012 * (width / height));
  gl.uniform4f(uniforms.imageFit, 1, 1, 0, 0);
  gl.viewport(0, 0, width, height);

  return {
    gl,
    canvas,
    sampler,
    segmenter,
    modelInput: new Float32Array(pixels * 3),
    runningMask: new Float32Array(pixels),
    maskBytes: new Uint8Array(pixels),
    cameraTexture,
    maskTexture,
    imageTexture,
    uniforms,
    firstMask: true,
    mode: "none",
  };
}

/** Draw one camera frame with the current background. */
function composite(running: Compositor, frame: CanvasImageSource & TexImageSource): void {
  const { gl, sampler, segmenter } = running;

  if (running.mode !== "none") {
    const { width, height } = segmenter.frame;
    sampler.drawImage(frame, 0, 0, width, height);
    toModelInput(sampler.getImageData(0, 0, width, height).data, running.modelInput);
    const mask = segmenter.segment(running.modelInput);
    steadyMask(running.runningMask, mask, running.maskBytes, running.firstMask);
    running.firstMask = false;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, running.maskTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      width,
      height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      running.maskBytes,
    );
  }

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, running.cameraTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  // Always, not only for blur: the camera's texture samples through its mipmap chain, and a chain
  // that was never built is an incomplete texture, which WebGL draws as black.
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.uniform1i(running.uniforms.mode, modeCode(running.mode));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function setBackground(running: Compositor, mode: BackgroundMode, image: ImageBitmap | null): void {
  const { gl } = running;
  if (image !== null) {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, running.imageTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    const fit = coverFit(image.width, image.height, running.canvas.width, running.canvas.height);
    gl.uniform4f(running.uniforms.imageFit, fit[0], fit[1], fit[2], fit[3]);
    image.close();
  }
  if (mode !== running.mode) running.firstMask = true;
  running.mode = mode;
}

/** Read frames from one stream, draw them, and write them to the other, until either ends. */
async function pump(
  running: Compositor,
  input: ReadableStream<VideoFrame>,
  output: WritableStream<VideoFrame>,
): Promise<void> {
  const reader = input.getReader();
  const writer = output.getWriter();
  try {
    while (!stopped) {
      const { value: frame, done } = await reader.read();
      if (done) break;
      try {
        composite(running, frame);
        const drawn = new VideoFrame(running.canvas, {
          timestamp: frame.timestamp,
          ...(frame.duration === null ? {} : { duration: frame.duration }),
        });
        await writer.write(drawn);
      } finally {
        frame.close();
      }
    }
  } catch {
    if (!stopped) fail("graphics");
  } finally {
    reader.releaseLock();
    await writer.close().catch(() => undefined);
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  switch (request.type) {
    case "start": {
      void buildCompositor(request.width, request.height).then(
        (built) => {
          compositor = built;
          setBackground(built, request.mode, request.image);
          scope.postMessage({ type: "ready" });
          if (request.input !== undefined && request.output !== undefined) {
            void pump(built, request.input, request.output);
          }
        },
        (error: unknown) => {
          request.image?.close();
          fail(error instanceof Error && error.message === "engine" ? "engine" : "graphics");
        },
      );
      return;
    }
    case "background": {
      if (compositor === null) {
        request.image?.close();
        return;
      }
      setBackground(compositor, request.mode, request.image);
      return;
    }
    case "frame": {
      if (compositor === null) {
        request.frame.close();
        return;
      }
      try {
        composite(compositor, request.frame);
        const drawn = compositor.canvas.transferToImageBitmap();
        scope.postMessage({ type: "frame", frame: drawn }, [drawn]);
      } catch {
        fail("graphics");
      } finally {
        request.frame.close();
      }
      return;
    }
    case "stop": {
      stopped = true;
      compositor?.segmenter.release();
      compositor = null;
      self.close();
      return;
    }
  }
};
