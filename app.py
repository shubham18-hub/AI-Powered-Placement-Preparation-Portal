import os
from flask import Flask, request, jsonify # or FastAPI equivalents

app = Flask(__name__)

# Ensure upload directory exists to prevent FileNotFoundError
UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/api/resumes', methods=['GET'])
def get_resumes():
    try:
        # Check Authorization header safely
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'error': 'Authorization token required'}), 401
            
        # Example query returning user's resumes
        # Replace with your DB query logic
        resumes = [] 
        return jsonify(resumes), 200
    except Exception as e:
        print(f"Error in /api/resumes: {str(e)}")
        return jsonify({'error': 'Failed to fetch resumes', 'details': str(e)}), 500


@app.route('/api/ats', methods=['GET', 'POST'])
def ats_score():
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'error': 'Authorization token required'}), 401
            
        # Stub response for ATS evaluation
        ats_data = {
            "score": 82,
            "matched_keywords": ["React", "Python", "REST API"],
            "missing_keywords": ["Docker", "AWS"],
            "feedback": "Strong technical skills listed. Add cloud infrastructure experience."
        }
        return jsonify(ats_data), 200
    except Exception as e:
        print(f"Error in /api/ats: {str(e)}")
        return jsonify({'error': 'ATS calculation failed', 'details': str(e)}), 500


@app.route('/api/resume/upload', methods=['POST'])
def upload_resume():
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'error': 'Authorization token required'}), 401

        if 'file' not in request.files:
            return jsonify({'error': 'No file attached'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400

        save_path = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(save_path)

        return jsonify({
            'message': 'Resume uploaded successfully',
            'filename': file.filename,
            'status': 'processed'
        }), 201
    except Exception as e:
        print(f"Error in /api/resume/upload: {str(e)}")
        return jsonify({'error': 'File upload failed', 'details': str(e)}), 500