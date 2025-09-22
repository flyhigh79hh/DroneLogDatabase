import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface BatteryChartProps {
  flightData: Array<{ timestamp: string; rxBt: number }>;
  labels: string[];
}

const BatteryChart: React.FC<BatteryChartProps> = ({ flightData, labels }) => {
  const data = {
    labels: labels,
    datasets: [
      {
        label: 'Receiver Battery Voltage (V)',
        data: flightData.map(point => point.rxBt),
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.5)',
        tension: 0.1,
        pointRadius: 0, // Hide points for smoother line
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false, // Allow chart to fill container
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Receiver Battery Voltage Over Time',
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Time (minutes:seconds)',
        },
      },
      y: {
        title: {
          display: true,
          text: 'Voltage (V)',
        },
      },
    },
  };

  return <Line data={data} options={options} />;
};

export default BatteryChart;