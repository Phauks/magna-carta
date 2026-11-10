// The generated WebAssembly bindings build a `TextDecoder` the moment they load, to read the engine's
// error codes. An AudioWorklet's global scope does not have one in every browser, and the load would
// then throw before a single frame was cleaned. The engine's only strings are its error codes, which
// are ASCII, so this decodes ASCII and nothing else. It is installed only where there is none.
if (typeof globalThis.TextDecoder === "undefined") {
  class AsciiTextDecoder {
    decode(input?: ArrayBufferView | ArrayBuffer): string {
      if (input === undefined) return "";
      const bytes =
        input instanceof ArrayBuffer
          ? new Uint8Array(input)
          : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte & 0x7f);
      return text;
    }
  }
  Reflect.set(globalThis, "TextDecoder", AsciiTextDecoder);
}
