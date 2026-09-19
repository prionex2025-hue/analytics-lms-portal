const fs = require("fs");

jest.mock("../../modules/resources/services/resource.service", () => ({
  getActorFromRequest: jest.fn(),
  prepareResourceDownload: jest.fn(),
}));

const {
  getActorFromRequest,
  prepareResourceDownload,
} = require("../../modules/resources/services/resource.service");
const { downloadResource } = require("../../modules/resources/controllers/resource.controller");

describe("learning resources controller", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("sanitizes downloaded attachment filenames before setting response headers", async () => {
    const stream = {
      on: jest.fn(function on() {
        return this;
      }),
      pipe: jest.fn(),
    };
    stream.pipe.mockImplementation(() => {});

    jest.spyOn(fs, "createReadStream").mockReturnValue(stream);
    getActorFromRequest.mockReturnValue({ id: "student-1", role: "STUDENT" });
    prepareResourceDownload.mockResolvedValue({
      type: "file",
      filePath: "C:\\safe\\resource.pdf",
      mimeType: "application/pdf",
      originalFileName: "bad\"\r\nname.pdf",
      fileSize: 42,
    });

    const res = {
      setHeader: jest.fn(),
      status: jest.fn(function status() {
        return this;
      }),
      json: jest.fn(),
      destroy: jest.fn(),
      headersSent: false,
    };

    await new Promise((resolve, reject) => {
      stream.pipe.mockImplementation(() => resolve());
      downloadResource({ params: { id: "resource-1" } }, res, reject);
    });

    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      "attachment; filename=\"badname.pdf\""
    );
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });
});
