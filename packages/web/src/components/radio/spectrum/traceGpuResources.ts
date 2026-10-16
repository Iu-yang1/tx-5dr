/** Own every allocation from the *current* WebGL context generation. */
export interface SpectrumTraceGpuResources {
  program: WebGLProgram | null;
  buffer: WebGLBuffer | null;
  previousBuffer: WebGLBuffer | null;
  fillBuffer: WebGLBuffer | null;
  fillPreviousBuffer: WebGLBuffer | null;
  supplementBuffer: WebGLBuffer | null;
  supplementPreviousBuffer: WebGLBuffer | null;
}

export function releaseSpectrumTraceGpuResources(
  gl: Pick<WebGLRenderingContext, 'deleteBuffer' | 'deleteProgram'>,
  resources: SpectrumTraceGpuResources,
): void {
  for (const buffer of [
    resources.buffer,
    resources.previousBuffer,
    resources.fillBuffer,
    resources.fillPreviousBuffer,
    resources.supplementBuffer,
    resources.supplementPreviousBuffer,
  ]) {
    if (buffer) gl.deleteBuffer(buffer);
  }
  if (resources.program) gl.deleteProgram(resources.program);
}
