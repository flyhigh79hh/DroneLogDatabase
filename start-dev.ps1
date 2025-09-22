# Start the backend server
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; .\.venv\Scripts\activate; uvicorn main:app --reload"

# Start the frontend server
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"
