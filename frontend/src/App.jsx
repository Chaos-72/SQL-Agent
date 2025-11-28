import { useState } from "react";
import FileUpload from "./components/FileUpload";
import QueryBox from "./components/QueryBox";
import Results from "./components/Results";
import robot from "./assets/robot.png";


export default function App() {
  const [sessionId, setSessionId] = useState(null);
  const [tables, setTables] = useState([]);
  const [result, setResult] = useState(null);

  return (
    <div className="d-flex mt-4  flex-column justify-content-center align-items-center bg-light">
      <div className=" text-center  -success w-100">
        <h1 className=" fw-bold text-"> 
         SQL Agent</h1>
        <i className="mb-5">Chat with your data</i>

        {/* If no session yet, show upload */}
        {!sessionId && (
          <div className="d-flex   justify-content-center">
            <div className="w-100" style={{ maxWidth: "900px" }}>
              <FileUpload
                onUpload={(sid, t) => {
                  setSessionId(sid);
                  setTables(t);
                }}
              />
            </div>
          </div>
        )}

        {/* Once uploaded, show query + results */}
        {sessionId && (
          <div
            className="mx-auto  bg-grey  w-100  mt-4 bg-white rounded-4 shadow p-4 text-start"
            style={{ maxWidth: "900px" }}
          >
            <div className="mb-4">
              <h5 className="text-secondary">Session Information</h5>
              <p className="mb-1">
                <strong>Session ID:</strong> <span className="text-muted">{sessionId}</span>
              </p>
              <p className="mb-1">
                <strong>Tables:</strong>
              </p>
              <ul className="ms-3 text-muted">
                {tables.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>

            <QueryBox sessionId={sessionId} onResult={(res) => setResult(res)} />

            {result && (
              <div className="mt-4">
                <Results data={result} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
