# DroneLogger Application

This document provides an overview of the DroneLogger application and instructions on how to set up and run it.

## Project Overview

The DroneLogger is a web application designed to help users manage their drones and flight logs. It allows for defining multiple pilots, importing flight data from CSV files, manually adding flight records, and storing detailed notes for each drone and flight.

**Technologies Used:**
*   **Backend:** Python with FastAPI
*   **Database:** PostgreSQL
*   **Frontend:** React with TypeScript (Vite)

## Setup and Running Instructions

The recommended way to run this application is by using Docker.

### Frontend Development (Optional)

If you want to work on the frontend code with live-reloading, you can run it outside of Docker:

1.  **Navigate to the frontend directory:**
    ```bash
    cd frontend
    ```

2.  **Install frontend dependencies:**
    ```bash
    npm install
    ```

3.  **Run the React development server:**
    ```bash
    npm run dev
    ```
    The frontend will typically run on `http://localhost:5173`. It will connect to the backend running in Docker.

### Docker Setup

To run the entire application using Docker, you will need to have Docker and Docker Compose installed.

1.  **Build and run the containers:**
    ```bash
    docker-compose up --build -d
    ```
    This will start the frontend, backend, and a PostgreSQL database container in the background.

2.  **Access the application:**
    *   Frontend: `http://localhost:5173`
    *   Backend API: `http://localhost:8000`
    *   PostgreSQL Database: `localhost:5432` (user: `dronelogger`, password: `dronelogger`, db: `dronelogger`)

3.  **Stopping the application:**
    ```bash
    docker-compose down
    ```
    To remove the database volume as well, run `docker-compose down -v`.