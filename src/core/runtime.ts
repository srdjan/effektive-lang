// @light-fp prelude

/** Values that initialize a native map. */
export type MapEntries<Key, Value> = Iterable<readonly [Key, Value]>;

/** Values that initialize a native set. */
export type SetValues<Value> = Iterable<Value>;

export type NativeArrayLength = number;
export type NativeArrayIndex = number;
export type Byte = number;
export type SignedInteger = number;
export type UnsignedInteger = number;
export type Bytes = Iterable<Byte>;
export type SignedIntegers = Iterable<SignedInteger>;
export type UnsignedIntegers = Iterable<UnsignedInteger>;
export type RuntimeText = string;
export type UnknownValue = unknown;
export type NativeBuffer = ArrayBufferLike;

/** Construct an empty native map. */
export function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map<Key, Value>();
}

/** Delete a key and return its outcome with the same native map owner. */
export function deleteMapEntry<Key, Value>(
  map: Map<Key, Value>,
  key: Key,
): { readonly map: Map<Key, Value>; readonly deleted: boolean } {
  return { map: map, deleted: map.delete(key) };
}

/** Construct a native map from entries. */
export function mapFrom<Key, Value>(
  entries: MapEntries<Key, Value>,
): Map<Key, Value> {
  return new Map(entries);
}

/** Construct an empty native set. */
export function emptySet<Value>(): Set<Value> {
  return new Set<Value>();
}

/** Construct a native set from values. */
export function setFrom<Value>(values: SetValues<Value>): Set<Value> {
  return new Set(values);
}

/** Construct a zero-filled native byte array. */
export function byteArray(length: NativeArrayLength): Uint8Array {
  return new Uint8Array(length);
}

/** Construct a native byte array from values. */
export function byteArrayFrom(values: Bytes): Uint8Array {
  return Uint8Array.from(values);
}

/** Construct a zero-filled native signed integer array. */
export function int32Array(length: NativeArrayLength): Int32Array {
  return new Int32Array(length);
}

/** Construct a native signed integer array from values. */
export function int32ArrayFrom(values: SignedIntegers): Int32Array {
  return Int32Array.from(values);
}

/** Construct a zero-filled native unsigned integer array. */
export function uint32Array(length: NativeArrayLength): Uint32Array {
  return new Uint32Array(length);
}

/** Construct a native unsigned integer array from values. */
export function uint32ArrayFrom(values: UnsignedIntegers): Uint32Array {
  return Uint32Array.from(values);
}

/** Encode text as native UTF-8 bytes. */
export function utf8Bytes(text: RuntimeText): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Construct a native data view. */
export function dataView(buffer: NativeBuffer): DataView {
  return new DataView(buffer);
}

/** Copy bytes into a native byte array and return that same array. */
export function copyBytes(target: Uint8Array, source: Uint8Array): Uint8Array {
  return target.set(source) ?? target;
}

/** Write one unsigned word and return the same native data view. */
export function setUint32(
  target: DataView,
  index: NativeArrayIndex,
  value: UnsignedInteger,
): DataView {
  return target.setUint32(index, value) ?? target;
}

/** Iterate the integer indices in the half-open range from zero to count. */
export function* indices(
  count: NativeArrayLength,
): IterableIterator<NativeArrayIndex> {
  for (let index = 0; index < count; index += 1) {
    yield index;
  }
}

/** Iterate the integer indices from count minus one down to zero. */
export function* reverseIndices(
  count: NativeArrayLength,
): IterableIterator<NativeArrayIndex> {
  for (let index = count - 1; index >= 0; index -= 1) {
    yield index;
  }
}

/** Read the message of an unknown thrown value. */
export function unknownMessage(thrown: UnknownValue): RuntimeText {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/** Construct a native arbitrary-precision integer from decimal text. */
export const bigInteger = BigInt;

/** Decode one native URI component. */
export const decodeUriComponent = decodeURIComponent;

/** Iterate a native array from the end and remove each yielded value. */
export function stackValues<Value>(values: Value[]): Iterable<Value> {
  return {
    [Symbol.iterator](): Iterator<Value> {
      return {
        next(): IteratorResult<Value> {
          if (values.length === 0) return { done: true, value: undefined };
          const index = values.length - 1;
          const value = values[index];
          values.length = index;
          return { done: false, value: value };
        },
      };
    },
  };
}

/** Parse an explicit timestamp with the native date grammar. */
export const timeValue = Date.parse;

/** Test native property presence across the prototype chain. */
export const hasProperty = Reflect.has;
