import Swal from "sweetalert2";

const THEME = {
  background: "var(--bg-secondary)",
  color: "var(--text-main)",
};

export const swalSuccess = (title, text) =>
  Swal.fire({
    ...THEME,
    title,
    text,
    icon: "success",
    confirmButtonColor: "var(--accent)",
  });

export const swalError = (title, text) =>
  Swal.fire({
    ...THEME,
    title,
    text,
    icon: "error",
    confirmButtonColor: "var(--accent)",
  });

export const swalConfirm = (title, text, confirmText = "Yes") =>
  Swal.fire({
    ...THEME,
    title,
    text,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: "Cancel",
    confirmButtonColor: "var(--danger)",
    cancelButtonColor: "var(--bg-tertiary)",
  });
// fallow-ignore-next-line unused-export
export const swalInfo = (title, text) =>
  Swal.fire({
    ...THEME,
    title,
    text,
    icon: "info",
    confirmButtonColor: "var(--accent)",
  });
