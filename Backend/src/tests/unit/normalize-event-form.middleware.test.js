const { normalizeEventForm } = require("../../middleware/normalize-event-form");

describe("normalizeEventForm middleware", () => {
  it("parses multipart-style event fields into validated shapes", () => {
    const req = {
      body: {
        title: " Tech Fest 2026 ",
        description: " Annual event ",
        eventType: "Workshop",
        startsAt: "2026-05-12T10:00:00.000Z",
        endsAt: "2026-05-12T12:00:00.000Z",
        eventDate: "2026-05-12T00:00:00.000Z",
        registrationDeadline: "2026-05-10T00:00:00.000Z",
        location: " Main Auditorium ",
        registrationLimit: "250",
        maxParticipants: "250",
        registrationUrl: "https://example.com/register",
        visibilityScope: "INTER_COLLEGE",
        feeType: "paid",
        registrationFee: "149.5",
        allColleges: "false",
        collegeIds: JSON.stringify(["college-1", "college-2"]),
        registrationFields: JSON.stringify([
          {
            key: "github",
            label: "GitHub Profile",
            type: "text",
            required: "true",
            options: [],
            meta: { note: "optional metadata" },
          },
        ]),
      },
    };

    let nextCalled = false;
    normalizeEventForm(req, {}, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.body).toMatchObject({
      title: "Tech Fest 2026",
      description: "Annual event",
      eventType: "Workshop",
      location: "Main Auditorium",
      registrationLimit: 250,
      maxParticipants: 250,
      feeType: "paid",
      registrationFee: 149.5,
      allColleges: false,
      collegeIds: ["college-1", "college-2"],
      visibilityScope: "INTER_COLLEGE",
    });
    expect(req.body.registrationFields).toEqual([
      {
        key: "github",
        label: "GitHub Profile",
        type: "text",
        required: true,
        options: [],
        meta: { note: "optional metadata" },
      },
    ]);
  });
});
