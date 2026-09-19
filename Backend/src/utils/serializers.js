const { normalizeRole } = require("../constants/roles");

const toPublicAdmin = (admin = {}) => {
  if (!admin) {
    return null;
  }

  return {
    id: admin.id,
    employeeId: admin.employeeId || null,
    fullName: admin.fullName || null,
    email: admin.email || null,
    role: normalizeRole(admin.role),
    permissions: Array.isArray(admin.permissions) ? admin.permissions : [],
    accessProfile: admin.accessProfile || null,
    isActive: admin.isActive !== false,
    collegeId: admin.collegeId || null,
    departmentId: admin.departmentId || null,
    college: admin.college || null,
    department: admin.department || null,
    createdAt: admin.createdAt || null,
    updatedAt: admin.updatedAt || null,
  };
};

const toPublicAdmins = (admins = []) => admins.map(toPublicAdmin).filter(Boolean);

const toPublicStudent = (student = {}) => {
  if (!student) {
    return null;
  }

  const {
    passwordHash: _passwordHash,
    passwordResetToken: _passwordResetToken,
    passwordResetExpires: _passwordResetExpires,
    avatarPublicId: _avatarPublicId,
    ...safe
  } = student;

  return safe;
};

const toPublicStudents = (students = []) => students.map(toPublicStudent).filter(Boolean);

module.exports = {
  toPublicAdmin,
  toPublicAdmins,
  toPublicStudent,
  toPublicStudents,
};
