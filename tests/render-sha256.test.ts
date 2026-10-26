import { sha256 } from "@/render/sha256";

const vectors: [string, string][] = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ["é", "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c"],
  ["Projet -> atteindre les Indes\norientales", "d1ebe7579ea937ad705b2ef522c4fdf963521b87b47a755af37cf0b3323b5da7"],
  ["𝒳 and 日本語 and 😀", "e6fc8ed0cd66933e418582db162b1192ca7260bb1739158937104d81ce054561"],
  ["a".repeat(55), "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318"],
  ["a".repeat(56), "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a"],
  ["a".repeat(63), "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34"],
  ["a".repeat(64), "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"],
  ["a".repeat(65), "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0"],
  ["x".repeat(20000), "42e8bc96b8eec8c4e5d503483ba0cb843ce95243c8ca8575ffc69cd25d12c61c"],
];

describe("sha256", () => {
  it.each(vectors.map(([text, digest]) => [text.length, text, digest] as const))("gives the digest of a text of %i characters", (_length, text, digest) => {
    expect(sha256(text)).toBe(digest);
  });

  it("gives the same digest for a lone surrogate as for the replacement character", () => {
    expect(sha256("a\uD800b")).toBe("05087813392efc16fe8ff448920c6328e53af865df39419436659d9ffda90f7b");
  });
});
