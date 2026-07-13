import {
  planShareIngest,
  describeIgnored,
  toFileUri,
  MAX_SHARED_IMAGES,
} from '@/services/shareIntentIngest';
import type { ShareIntentFile } from 'expo-share-intent';

function file(over: Partial<ShareIntentFile>): ShareIntentFile {
  return {
    fileName: 'poza.jpg',
    mimeType: 'image/jpeg',
    path: '/tmp/poza.jpg',
    size: 100,
    width: null,
    height: null,
    duration: null,
    ...over,
  };
}

describe('planShareIngest', () => {
  it('pune imaginile în ordine, fără pdf', () => {
    const plan = planShareIngest([
      file({ fileName: 'a.jpg' }),
      file({ fileName: 'b.png', mimeType: 'image/png' }),
    ]);
    expect(plan.images.map(f => f.fileName)).toEqual(['a.jpg', 'b.png']);
    expect(plan.pdf).toBeNull();
    expect(plan.ignored).toHaveLength(0);
  });

  it('separă PDF-ul de imagini', () => {
    const plan = planShareIngest([
      file({ fileName: 'a.jpg' }),
      file({ fileName: 'doc.pdf', mimeType: 'application/pdf' }),
    ]);
    expect(plan.images).toHaveLength(1);
    expect(plan.pdf?.fileName).toBe('doc.pdf');
  });

  it('recunoaște PDF după extensie când mimeType e generic', () => {
    const plan = planShareIngest([
      file({ fileName: 'Contract.PDF', mimeType: 'application/octet-stream' }),
    ]);
    expect(plan.pdf?.fileName).toBe('Contract.PDF');
  });

  it('al doilea PDF e ignorat', () => {
    const plan = planShareIngest([
      file({ fileName: 'a.pdf', mimeType: 'application/pdf' }),
      file({ fileName: 'b.pdf', mimeType: 'application/pdf' }),
    ]);
    expect(plan.pdf?.fileName).toBe('a.pdf');
    expect(plan.ignored.map(f => f.fileName)).toEqual(['b.pdf']);
  });

  it('limitează imaginile la MAX_SHARED_IMAGES', () => {
    const files = Array.from({ length: MAX_SHARED_IMAGES + 2 }, (_, i) =>
      file({ fileName: `p${i}.jpg`, path: `/tmp/p${i}.jpg` })
    );
    const plan = planShareIngest(files);
    expect(plan.images).toHaveLength(MAX_SHARED_IMAGES);
    expect(plan.ignored).toHaveLength(2);
  });

  it('tipurile nesuportate merg la ignored', () => {
    const plan = planShareIngest([
      file({ fileName: 'x.docx', mimeType: 'application/vnd.openxmlformats' }),
    ]);
    expect(plan.images).toHaveLength(0);
    expect(plan.pdf).toBeNull();
    expect(plan.ignored).toHaveLength(1);
  });
});

describe('describeIgnored', () => {
  it('null când nu e nimic ignorat', () => {
    expect(describeIgnored(planShareIngest([file({})]))).toBeNull();
  });

  it('mesaj RO cu numele fișierelor ignorate', () => {
    const msg = describeIgnored(
      planShareIngest([file({ fileName: 'x.docx', mimeType: 'application/msword' })])
    );
    expect(msg).toContain('x.docx');
    expect(msg).toContain('imagini');
  });
});

describe('toFileUri', () => {
  it('adaugă prefixul file://', () => {
    expect(toFileUri('/var/mobile/f.jpg')).toBe('file:///var/mobile/f.jpg');
  });

  it('păstrează URI-urile care au deja prefix', () => {
    expect(toFileUri('file:///var/mobile/f.jpg')).toBe('file:///var/mobile/f.jpg');
  });
});
