import { useState, useCallback } from "react";
import axios from "axios";
import { useDropzone } from "react-dropzone";

export default function FileUpload({ onUpload }) {
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const onDrop = useCallback((acceptedFiles) => {
        if (acceptedFiles && acceptedFiles.length > 0) {
            setFile(acceptedFiles[0]);
            setError("");
            setSuccess("");
        }
    }, []);

    const {
        getRootProps,
        getInputProps,
        isDragActive,
    } = useDropzone({
        onDrop,
        accept: {
            "text/csv": [".csv"],
            "application/vnd.ms-excel": [".xls"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
        },
        multiple: true,
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!file) {
            setError("Please select a file first.");
            return;
        }

        setLoading(true);
        setError("");
        setSuccess("");

        try {
            const formData = new FormData();
            formData.append("file", file);

            const res = await axios.post("http://127.0.0.1:8000/upload", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });

            setSuccess("File uploaded successfully!");
            onUpload(res.data.session_id, res.data.tables);
        } catch (err) {
            setError(err.response?.data?.detail || "Upload failed. Try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="my-5 w-100">
            <div className="card shadow-sm border-0">
                <div className="card-body text-start    ">
                    <h5 className="mb-4">Upload File (CSV or Excel)</h5>

                    {/* Drag & Drop Zone */}
                    <div
                        {...getRootProps()}
                        className={`bg-grey text-center border-dashed rounded p-5 mb-3 ${isDragActive ? "border-primary bg-light" : "border-secondary"
                            }`}
                        style={{ cursor: "pointer", transition: "0.2s" }}
                    >
                        <input {...getInputProps()} />
                        {isDragActive ? (
                            <p className="text-primary fw-semibold">
                                Drop your file here...
                            </p>
                        ) : (
                              <p className="text-muted ">
                                Drag & drop your file here, or click to select a file
                                <i className="fa-solid fa-cloud-arrow-up fa-2x mt-2 text-primary"></i>
                              </p>
                            
                        )}
                        {file && (
                            <div className="mt-3">
                                <span className="badge bg-success">{file.name}</span>
                            </div>
                        )}
                    </div>

                    {/* Choose File (Manual Input) */}
                    {/* <div className="mb-3">
            <input
              type="file"
              accept=".csv, .xls, .xlsx"
              onChange={(e) => {
                setFile(e.target.files[0]);
                setError("");
                setSuccess("");
              }}
              className="form-control"
            />
          </div> */}

                    {/* Upload Button */}
                    <button
                        type="submit"
                        onClick={handleSubmit}
                        disabled={loading}
                        className="btn btn-primary w-100"
                    >
                        {loading ? "Uploading..." : "Upload"}
                    </button>

                    {/* Alerts */}
                    {error && (
                        <div className="alert alert-danger mt-3" role="alert">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="alert alert-success mt-3" role="alert">
                            {success}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
