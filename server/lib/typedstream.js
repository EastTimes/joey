// Decodes Apple's NSArchiver "streamtyped" attributedBody blobs to plain text.
// Heuristic: find the last "NSString" class name, scan forward to the '+' (0x2b)
// marker, read the length-prefixed UTF-8 string that follows.

const NSSTRING = Buffer.from('NSString', 'ascii');
const OBJ_REPLACEMENT = /￼/g;

function lastIndexOfSeq(buf, seq) {
  for (let i = buf.length - seq.length; i >= 0; i--) {
    let match = true;
    for (let j = 0; j < seq.length; j++) {
      if (buf[i + j] !== seq[j]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

export function decodeAttributedBody(buf) {
  try {
    if (!buf || !Buffer.isBuffer(buf) || buf.length < 16) return null;

    const at = lastIndexOfSeq(buf, NSSTRING);
    if (at === -1) return null;

    // Scan forward (bounded) for the '+' marker after the class name.
    let plus = -1;
    const scanEnd = Math.min(buf.length, at + NSSTRING.length + 16);
    for (let i = at + NSSTRING.length; i < scanEnd; i++) {
      if (buf[i] === 0x2b) { plus = i; break; }
    }
    if (plus === -1) return null;

    let pos = plus + 1;
    if (pos >= buf.length) return null;

    let len;
    const first = buf[pos];
    if (first === 0x81) {
      if (pos + 3 > buf.length) return null;
      len = buf.readUInt16LE(pos + 1);
      pos += 3;
    } else if (first === 0x82) {
      if (pos + 5 > buf.length) return null;
      len = buf.readUInt32LE(pos + 1);
      pos += 5;
    } else {
      len = first;
      pos += 1;
    }

    if (len <= 0 || pos + len > buf.length) return null;

    const text = buf
      .toString('utf8', pos, pos + len)
      .replace(OBJ_REPLACEMENT, '')
      .trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
