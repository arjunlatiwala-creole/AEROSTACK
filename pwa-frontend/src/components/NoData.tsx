import NODATA from "@/assets/images/no-data.svg"
import { cn } from "@/lib/utils";

const NoData = ({ className }: { className?: string }) => {
  return (
    <div className="flex flex-col items-center" role="group" aria-label="No data available">
      <img
        src={NODATA}
        alt="No data available"
        role="img"
        aria-label="Illustration representing no data"
        loading="lazy"
        className={cn('h-24', className)}
      />
      <p className="mt-2 text-sm text-gray-600">No data available</p>
    </div>
  );
};

export default NoData;
