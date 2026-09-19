export const SITE_URL = "https://lms.analyticsedify.com";
export const SITE_NAME = "Analytics Edify LMS";
export const LOGO_URL = `${SITE_URL}/analytics-edify-logo.png`;
export const TWITTER_HANDLE = "@analyticsedify";
export const COMPANY_LEGAL_NAME = "Analytics Edifying Solutions Private Limited";
export const COMPANY_INCORPORATED_DATE = "2017-07-20";

export const STUDENT_LOGIN_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "EducationalOrganization",
  name: "Analytics Edify",
  legalName: COMPANY_LEGAL_NAME,
  alternateName: ["Analytics LMS", SITE_NAME],
  url: "https://analyticsedify.com",
  logo: LOGO_URL,
  foundingDate: COMPANY_INCORPORATED_DATE,
  address: {
    "@type": "PostalAddress",
    addressLocality: "Chennai",
    addressRegion: "Tamil Nadu",
    addressCountry: "IN",
  },
  areaServed: {
    "@type": "Country",
    name: "India",
  },
  identifier: {
    "@type": "PropertyValue",
    propertyID: "Registrar of Companies",
    value: "Chennai, Tamil Nadu",
  },
  description:
    "Analytics Edify provides aptitude, coding, communication, and placement training for college students.",
  sameAs: ["https://twitter.com/analyticsedify"],
};

export const LOGIN_SEO = {
  student: {
    title: `Student Login | ${SITE_NAME}`,
    description:
      "Log in to Analytics Edify LMS to access your aptitude, coding, and placement training courses.",
    keywords:
      "Analytics Edifying Solutions Private Limited, Analytics Edify LMS, Analytics LMS student login, Chennai LMS, Tamil Nadu LMS, student portal, online test portal, placement preparation",
    canonicalUrl: `${SITE_URL}/login`,
    robots: "index, follow",
    googlebot: "index, follow",
    ogTitle: `Student Login | ${SITE_NAME}`,
    ogDescription:
      "Log in to Analytics Edify LMS to access your aptitude, coding, and placement training courses.",
    ogUrl: `${SITE_URL}/login`,
    structuredData: STUDENT_LOGIN_STRUCTURED_DATA,
  },
  admin: {
    title: `Admin Login | ${SITE_NAME}`,
    description: "Admin portal login for Analytics Edify LMS.",
    keywords:
      "Analytics Edify LMS admin login, Analytics Edify LMS admin portal, college LMS admin, assessment management portal",
    canonicalUrl: `${SITE_URL}/admin/login`,
    robots: "noindex, nofollow",
    googlebot: "noindex, nofollow",
    ogTitle: `Admin Login | ${SITE_NAME}`,
    ogDescription: "Admin portal login for Analytics Edify LMS.",
    ogUrl: `${SITE_URL}/admin/login`,
  },
  collegeAdmin: {
    title: `College Admin Login | ${SITE_NAME}`,
    description: "College administrator login for Analytics Edify LMS.",
    keywords:
      "Analytics Edify LMS college admin login, college admin portal, institutional LMS analytics",
    canonicalUrl: `${SITE_URL}/college-admin/login`,
    robots: "noindex, nofollow",
    googlebot: "noindex, nofollow",
    ogTitle: `College Admin Login | ${SITE_NAME}`,
    ogDescription: "College administrator login for Analytics Edify LMS.",
    ogUrl: `${SITE_URL}/college-admin/login`,
  },
  superAdmin: {
    title: `Super Admin Login | ${SITE_NAME}`,
    description: "Super admin login for Analytics Edify LMS.",
    keywords:
      "Analytics Edify LMS super admin, Analytics Edify LMS super admin portal, LMS platform admin, global LMS analytics",
    canonicalUrl: `${SITE_URL}/super-admin/login`,
    robots: "noindex, nofollow",
    googlebot: "noindex, nofollow",
    ogTitle: `Super Admin Login | ${SITE_NAME}`,
    ogDescription: "Super admin login for Analytics Edify LMS.",
    ogUrl: `${SITE_URL}/super-admin/login`,
  },
};

export const DEFAULT_SEO = LOGIN_SEO.student;
