const { hasValidImageSignature } = require("../../middleware/upload");

describe("image upload validation", () => {
  it("accepts valid PNG and JPEG signatures", () => {
    expect(hasValidImageSignature({
      mimetype: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
    })).toBe(true);

    expect(hasValidImageSignature({
      mimetype: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    })).toBe(true);
  });

  it("rejects MIME spoofed image uploads", () => {
    expect(hasValidImageSignature({
      mimetype: "image/png",
      buffer: Buffer.from("<script>alert(1)</script>"),
    })).toBe(false);

    expect(hasValidImageSignature({
      mimetype: "image/jpeg",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    })).toBe(false);
  });
});
