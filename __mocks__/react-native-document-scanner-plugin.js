const ScanDocumentResponseStatus = {
  Success: 'success',
  Cancel: 'cancel',
};

const ResponseType = {
  ImageFilePath: 'imageFilePath',
  Base64: 'base64',
};

const scanDocument = jest.fn(() =>
  Promise.resolve({
    scannedImages: ['/tmp/scan_mock_1.jpg', '/tmp/scan_mock_2.jpg'],
    status: ScanDocumentResponseStatus.Success,
  })
);

module.exports = {
  __esModule: true,
  default: scanDocument,
  scanDocument,
  ScanDocumentResponseStatus,
  ResponseType,
};
