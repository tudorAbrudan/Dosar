import {
  displayToImage,
  imageToDisplay,
  defaultCorners,
  clampToImage,
  fitContain,
} from '@/components/cropper/cropperGeometry';

describe('cropperGeometry', () => {
  describe('displayToImage', () => {
    it('scalează corect 100x100 display → 1000x1000 image', () => {
      expect(displayToImage({ x: 50, y: 50 }, { w: 100, h: 100 }, { w: 1000, h: 1000 })).toEqual({
        x: 500,
        y: 500,
      });
    });

    it('păstrează raportul pe scale-uri asimetrice', () => {
      expect(displayToImage({ x: 50, y: 100 }, { w: 200, h: 400 }, { w: 1000, h: 2000 })).toEqual({
        x: 250,
        y: 500,
      });
    });
  });

  it('imageToDisplay e inversa lui displayToImage', () => {
    const d = { w: 200, h: 300 };
    const i = { w: 1000, h: 1500 };
    const p = { x: 700, y: 900 };
    const round = displayToImage(imageToDisplay(p, d, i), d, i);
    expect(round.x).toBeCloseTo(p.x);
    expect(round.y).toBeCloseTo(p.y);
  });

  describe('defaultCorners', () => {
    it('returnează un dreptunghi cu padding 10% pe fiecare latură', () => {
      const c = defaultCorners({ w: 1000, h: 1000 });
      expect(c.topLeft).toEqual({ x: 100, y: 100 });
      expect(c.topRight).toEqual({ x: 900, y: 100 });
      expect(c.bottomRight).toEqual({ x: 900, y: 900 });
      expect(c.bottomLeft).toEqual({ x: 100, y: 900 });
    });

    it('respectă raportul pe imagini portrait', () => {
      const c = defaultCorners({ w: 500, h: 1000 });
      expect(c.topLeft).toEqual({ x: 50, y: 100 });
      expect(c.bottomRight).toEqual({ x: 450, y: 900 });
    });
  });

  describe('clampToImage', () => {
    it('limitează puncte în afara cadrului', () => {
      expect(clampToImage({ x: -5, y: 1200 }, { w: 1000, h: 1000 })).toEqual({ x: 0, y: 1000 });
    });

    it('păstrează puncte în interior', () => {
      expect(clampToImage({ x: 500, y: 500 }, { w: 1000, h: 1000 })).toEqual({ x: 500, y: 500 });
    });
  });

  describe('fitContain', () => {
    it('încadrează imaginea landscape în container square (lățimea umple containerul)', () => {
      expect(fitContain({ w: 2000, h: 1000 }, { w: 400, h: 400 })).toEqual({ w: 400, h: 200 });
    });

    it('încadrează imaginea portrait în container square (înălțimea umple containerul)', () => {
      expect(fitContain({ w: 1000, h: 2000 }, { w: 400, h: 400 })).toEqual({ w: 200, h: 400 });
    });
  });
});
