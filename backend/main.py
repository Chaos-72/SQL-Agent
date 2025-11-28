"""
FastAPI + LangChain SQL Agent backend
- Upload CSV / Excel -> gets stored as SQLite DB per session
- Ask natural language question -> LangChain SQL agent converts to SQL -> result returned
- Safety: agent connects to DB in READ-ONLY mode (sqlite mode=ro)
"""

# Processing and configuration dependencies
import os
import re
import ast  # ✅ ADDED: Safe alternative to eval()
from uuid import uuid4
from typing import Literal, Optional, List, Dict, Any

from sqlalchemy import create_engine
import pandas as pd

# FastAPI configuration
from fastapi import FastAPI, UploadFile, HTTPException, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Langchain dependencies
from langchain_community.utilities.sql_database import SQLDatabase
from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_community.agent_toolkits.sql.base import create_sql_agent
from langchain.agents.agent_types import AgentType
from langchain.agents.agent_toolkits.sql.toolkit import SQLDatabaseToolkit
from dotenv import load_dotenv
import logging
import sys

load_dotenv()

# Configure logging to force output to stderr (bypasses LangChain capture)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(message)s',
    stream=sys.stderr,
    force=True
)
logger = logging.getLogger(__name__)

# -----------------------
# Config & helper utils
# -----------------------

# Where we keep uploaded files and sqlite DB files
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, 'uploads')
DB_DIR = os.path.join(BASE_DIR, 'databases')

# create directory if not exist
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(DB_DIR, exist_ok=True)

# Define/initialize the app

app = FastAPI(title="CSV/Excel -> SQL Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_table_name(name: str) -> str:
    """
    Turn a user filename or sheet name into a safe SQL table name.
    - lowercase
    - replace spaces / non-alnum with _
    - prefix with t_ if it starts with a number
    """

    name = name.strip().lower()
    name = re.sub(r"[^0-9a-z_]+", "_", name)
    if re.match(r"^\d", name):
        name = "t_" + name
    return name or "table1"

# -----------------------
# Pydantic models
# -----------------------

class UploadResponse(BaseModel):
    session_id: str
    tables: List[str]
    message: Optional[str] = None

class QueryRequest(BaseModel):
    session_id: str
    question: str
    top_k: int = 5  # How many rows does agent return by default

class QueryResponse(BaseModel):
    answer: str
    sql_queries: List[str]
    rows: Optional[List[Dict[str, Any]]] = None
    raw_agent_output: Dict[str, Any]

# -----------------------
# Upload endpoint
# -----------------------

@app.post("/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    """
    Accept the CSV/Excel file.
    - Save the uploaded files to disk.
    - Read it with pandas
    - Persist tables into a sqlite DB (in READ ONLY mode)
    - Return session_id and table name
    """
    filename = file.filename
    if not filename:
        raise HTTPException(status_code=400, detail="Missing Files..")
    
    # Generate session id and storage paths
    session_id = uuid4().hex
    saved_path = os.path.join(UPLOAD_DIR, f"{session_id}_{filename}")
    db_path = os.path.join(DB_DIR, f"{session_id}.db")
    db_uri = f"sqlite:///{db_path}"

    # save uploaded file to disk
    contents = await file.read()
    with open(saved_path, "wb") as f:
        f.write(contents)

    # Load file to pandas and write to sqlite

    try:
        if filename.lower().endswith('.csv'):
            # read the file as pandas DataFrame
            df = pd.read_csv(saved_path)
            table_name = _safe_table_name(os.path.splitext(filename)[0])
            engine = create_engine(db_uri, connect_args={'check_same_thread': False})
            df.to_sql(table_name, con=engine, index=False, if_exists="replace")
            tables = [table_name]

        elif filename.lower().endswith(('.xls', '.xlsx')):
            xls = pd.read_excel(saved_path, sheet_name=None)
            engine = create_engine(db_uri, connect_args={'check_same_thread': False})
            tables = []
            for sheet_name, df in xls.items():
                tn = _safe_table_name(sheet_name)
                df.to_sql(tn, con=engine, index=False, if_exists="replace")
                tables.append(tn)

        else:
            raise HTTPException(status_code=400, detail="Only CSV and Excel Files are supported")

    except Exception as e:
        # clean up partial files on failure
        if os.path.exists(saved_path):
            os.remove(saved_path)
        if os.path.exists(db_path):
            os.remove(db_path)

        # ✅ FIX #1: Added f-string prefix
        raise HTTPException(status_code=500, detail=f"Error processing file: {e}")

    return UploadResponse(session_id=session_id, tables=tables, message="Files processed into SQLite DB.")


# -----------------------
# Ask endpoint
# -----------------------

@app.post("/ask", response_model=QueryResponse)
async def ask_question(query: QueryRequest):
    """
    Endpoint: /ask
    --------------------
    Accepts a natural language question and uses LangChain's SQL agent
    to convert it into a SQL query, execute the query, and return
    both the natural language answer and SQL statement(s).

    ✅ Update (safe addition):
    - Adds structured 'rows' field to the JSON response if the SQL query 
      returns a table-like result.
    - Does NOT modify existing logic or response structure.
    """

    # Step 1️⃣: Find the SQLite database file for this session
    db_path = os.path.join(DB_DIR, f"{query.session_id}.db")
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail="Session not found")

    # Step 2️⃣: Connect to the SQLite database in READ-ONLY mode
    # ✅ FIX #6: Enforced read-only mode
    db = SQLDatabase.from_uri(f"sqlite:///file:{db_path}?mode=ro&uri=true")

    # Step 3️⃣: Initialize the toolkit and agent
    llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash")
    toolkit = SQLDatabaseToolkit(db=db, llm=llm)
    agent = create_sql_agent(
        llm=llm, 
        toolkit=toolkit, 
        verbose=True,
        agent_executor_kwargs={"return_intermediate_steps": True},
    )

    # Step 4️⃣: Run the LangChain SQL agent
    try:
        result = agent.invoke({"input": query.question})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {e}")

    # Step 5️⃣: Extract SQL queries from intermediate steps
    # ✅ CRITICAL FIX: intermediate_steps contains AgentAction OBJECTS, not dicts!
    sql_queries = []
    for step in result.get("intermediate_steps", []):
        if isinstance(step, (list, tuple)) and len(step) >= 2:
            tool_info = step[0]
            
            # Use direct attribute access (LangChain returns AgentAction objects)
            if hasattr(tool_info, "tool") and hasattr(tool_info, "tool_input"):
                if tool_info.tool == "sql_db_query":
                    sql_queries.append(tool_info.tool_input)

    # Step 6️⃣: Try to parse SQL result rows (optional safe addition)
    rows = None
    try:
        for step in result.get("intermediate_steps", []):
            if isinstance(step, (list, tuple)) and len(step) >= 2:
                tool_info, output = step[0], step[1]

                # Use direct attribute access for AgentAction objects
                if hasattr(tool_info, "tool") and tool_info.tool == "sql_db_query":
                    if isinstance(output, str) and output.strip().startswith("["):
                        # ✅ Use ast.literal_eval instead of eval
                        try:
                            rows = ast.literal_eval(output)
                        except (ValueError, SyntaxError) as e:
                            print(f"[Warning] Failed to parse SQL output: {e}")
                            rows = None

                    # Convert tuples -> list of dicts for clean JSON
                    if rows and isinstance(rows, list) and len(rows) > 0:
                        if isinstance(rows[0], (list, tuple)):
                            column_names = [f"col_{i+1}" for i in range(len(rows[0]))]
                            rows = [dict(zip(column_names, r)) for r in rows]
                    break  # Only take first SQL query result
    except Exception as e:
        print(f"[Warning] Could not extract SQL result rows: {e}")
        rows = None

    # Step 7️⃣: Return the response
    return QueryResponse(
        answer=result.get("output", ""),
        sql_queries=sql_queries,
        rows=rows,
        raw_agent_output=result
    )


# uvicorn main:app --reload --port 8000