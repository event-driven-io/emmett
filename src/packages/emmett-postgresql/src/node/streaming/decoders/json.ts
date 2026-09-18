import { StringDecoder } from './string';

export class JsonDecoder<Decoded> extends StringDecoder<Decoded> {
  constructor() {
    super((jsonString) => JSON.parse(jsonString) as Decoded);
  }
}
