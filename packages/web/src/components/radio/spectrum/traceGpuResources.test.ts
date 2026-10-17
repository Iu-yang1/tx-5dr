import { describe, expect, it, vi } from 'vitest';
import { releaseSpectrumTraceGpuResources } from './traceGpuResources';

describe('trace GPU lifecycle', () => {
  it('releases every current-generation buffer, including the two supplement buffers', () => {
    const deleteBuffer = vi.fn();
    const deleteProgram = vi.fn();
    const gl = { deleteBuffer, deleteProgram };
    const program = {} as WebGLProgram;
    const buffers = Array.from({ length: 6 }, () => ({} as WebGLBuffer));
    releaseSpectrumTraceGpuResources(gl, {
      program, buffer: buffers[0], previousBuffer: buffers[1],
      fillBuffer: buffers[2], fillPreviousBuffer: buffers[3],
      supplementBuffer: buffers[4], supplementPreviousBuffer: buffers[5],
    });
    expect(deleteBuffer.mock.calls.map(([b]) => b)).toEqual(buffers);
    expect(deleteProgram).toHaveBeenCalledWith(program);
  });

  it('can clean partially initialized or restored allocations without deleting null handles', () => {
    const deleteBuffer = vi.fn();
    const deleteProgram = vi.fn();
    const buffer = {} as WebGLBuffer;
    releaseSpectrumTraceGpuResources({ deleteBuffer, deleteProgram }, {
      program: null, buffer, previousBuffer: null, fillBuffer: null,
      fillPreviousBuffer: null, supplementBuffer: null, supplementPreviousBuffer: null,
    });
    expect(deleteBuffer).toHaveBeenCalledTimes(1);
    expect(deleteBuffer).toHaveBeenCalledWith(buffer);
    expect(deleteProgram).not.toHaveBeenCalled();
  });
});
