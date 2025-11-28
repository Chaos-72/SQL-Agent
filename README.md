# **SQL Agent**

A full-stack project that allows users to upload CSV/Excel files and query them using natural language in multiple languages.  
The system converts user queries into SQL, executes them on a SQLite database, and returns accurate results.

---

## 🚀 **Features**

### 🔹 **1. File Upload & Auto Database Creation**
- Users upload CSV or Excel files (multiple sheets supported).  
- System stores data in SQLite automatically.  
- Files and DBs are ignored from GitHub for security.

### 🔹 **2. Natural Language → SQL Conversion**
- Users can ask questions like:  
  **“Give me patients with heart disease and age above 40.”**  
- The agent returns:  
  1. The **generated SQL query**  
  2. The **actual records** from the database.

### 🔹 **3. Analytical Queries**
- Example:  
  **“Percentage of males and females having heart disease in their 30s.”**  
- Returns clean, summarized analytical output.

### 🔹 **4. Multi-Language Support**
- Works in **English**, **Hindi**, **Marathi**, and more.  
- Handles joins, subqueries, and complex SQL patterns.

### 🔹 **5. Clean Folder Structure**
- `databases/`, `uploads/`, `.env`, `.db`, `.csv` are ignored.  
- Only essential frontend + backend code is pushed.

---

## 🛠️ **Tech Stack**

### **Backend**
- Python  
- FastAPI  
- LangChain  
- SQLite  

### **Frontend**
- React  
- Vite  
- Tailwind  

### **LLM Providers**
- Google Gemini API  
- HuggingFace LLM  

---

## 📦 **Environment Setup**

Copy `example.env` → rename to `.env`  
Fill your keys:

```
GOOGLE_API_KEY=your-api-key
HUGGINGFACEHUB_ACCESS_TOKEN=your-api-key
```

---

## ▶️ **Running the Backend**

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

---

## ▶️ **Running the Frontend**

```bash
cd frontend
npm install
npm run dev
```